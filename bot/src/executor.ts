import { ProjectConfig } from "./config.js";
import { AgentName } from "./agents/index.js";
import { getRunner } from "./agents/index.js";
import { config } from "./config.js";
import { log } from "./logger.js";
import * as gitOps from "./gitOps.js";
import { checkGhAuth, getDefaultBranch, createPr } from "./prOps.js";
import type { Notifier } from "./jobQueue.js";

export interface ExecJob {
  chatId: string;
  project: ProjectConfig;
  agentName: AgentName;
  intentSummary: string;
  prompt: string;
}

function tailLines(text: string, n: number): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= n) return text;
  return "...(output troncato alle ultime " + n + " righe)...\n" + lines.slice(-n).join("\n");
}

function truncateTitle(text: string, max = 72): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).trimEnd() + "…";
}

function buildPrBody(job: ExecJob, branch: string, changed: string[]): string {
  const lines = [
    "**Intento originale (messaggio Telegram):**",
    job.prompt,
    "",
    `**Agente:** ${job.agentName}`,
    `**Branch:** ${branch}`,
    `**File modificati (${changed.length}):**`,
    ...changed.map((f) => `- ${f}`),
    "",
    `**Eseguito da:** S.A.V.I.A — ${new Date().toISOString()}`,
    "",
    "🤖 PR generata automaticamente da S.A.V.I.A. — revisionare prima del merge",
  ];
  return lines.join("\n");
}

interface CompletionInfo {
  project: string;
  branch: string;
  changed: string[];
  pushOk: boolean;
  pushError?: string;
  prUrl?: string;
  prError?: string;
}

function buildCompletionMessage(info: CompletionInfo): string {
  const fileList = info.changed.map((f) => `  - ${f}`).join("\n");
  const filesBlock = `File modificati: ${info.changed.length}\n${fileList}`;
  const header = `Progetto: ${info.project}\nBranch: ${info.branch}\n${filesBlock}`;

  if (info.prUrl) {
    return `✅ Completato — PR aperta\n${header}\n\n🔗 Revisiona qui: ${info.prUrl}`;
  }

  if (info.pushOk) {
    const prNote = info.prError
      ? `❌ PR non aperta: ${info.prError}`
      : "❌ PR non aperta (vedi avviso iniziale su gh).";
    return (
      `✅ Commit + push fatti sul branch locale\n${prNote}\n${header}\n\n` +
      `🔗 Push riuscito — apri la PR a mano: gh pr create --head ${info.branch}`
    );
  }

  return (
    `✅ Commit fatto sul branch locale\n❌ Push fallito: ${info.pushError}\n${header}\n\n` +
    `🔗 Pusha a mano: git push -u origin ${info.branch}`
  );
}

async function pushAndOpenPr(
  job: ExecJob,
  branch: string,
  changed: string[],
  ghUsable: boolean
): Promise<{ pushOk: boolean; pushError?: string; prUrl?: string; prError?: string }> {
  if (!ghUsable) {
    try {
      await gitOps.pushBranch(job.project.path, branch);
      return { pushOk: true, prError: "gh non autenticato/disponibile (vedi avviso iniziale)" };
    } catch (err) {
      return { pushOk: false, pushError: err instanceof Error ? err.message : String(err) };
    }
  }

  try {
    await gitOps.pushBranch(job.project.path, branch);
  } catch (err) {
    return { pushOk: false, pushError: err instanceof Error ? err.message : String(err) };
  }

  let base: string;
  try {
    base = await getDefaultBranch(job.project.path);
  } catch (err) {
    return {
      pushOk: true,
      prError:
        "impossibile determinare il branch di default del repo (gh repo view fallito): " +
        (err instanceof Error ? err.message : String(err)),
    };
  }

  try {
    const title = truncateTitle(job.intentSummary);
    const body = buildPrBody(job, branch, changed);
    const url = await createPr(job.project.path, { base, head: branch, title, body });
    return { pushOk: true, prUrl: url };
  } catch (err) {
    return { pushOk: true, prError: err instanceof Error ? err.message : String(err) };
  }
}

export async function executeJob(job: ExecJob, notifier: Notifier): Promise<void> {
  notifier.notify(
    job.chatId,
    `🚀 Avvio ${job.agentName} su ${job.project.name} ...\nIntento: ${job.intentSummary}`
  );

  const repo = job.project.path;
  let originalBranch = "";

  try {
    if (!(await gitOps.isWorkingTreeClean(repo))) {
      notifier.notify(
        job.chatId,
        `⛔ Working tree sporco su ${job.project.name}: non eseguo per non mischiare ` +
          `modifiche che non sono farina del mio sacco. Pulisci e riprova.`
      );
      return;
    }

    const gh = await checkGhAuth(repo);
    if (!gh.ok) {
      notifier.notify(
        job.chatId,
        `⚠️ gh non autenticato per questo repo (${gh.detail}) — procedo comunque con il ` +
          `branch locale, ma non potrò aprire la PR automaticamente.`
      );
    }
    const ghUsable = gh.ok;

    originalBranch = await gitOps.getCurrentBranch(repo);
    const branch = gitOps.makeBranchName(job.intentSummary);
    await gitOps.createBranch(repo, branch);

    const runner = getRunner(job.agentName, config.agentTimeoutMs);
    const result = await runner.run(repo, job.prompt);

    if (result.error === "TIMEOUT") {
      const changed = await gitOps.getChangedFiles(repo);
      if (changed.length > 0) {
        await gitOps.stashChanges(repo, `savia-timeout: ${job.intentSummary}`);
      }
      await gitOps.checkoutBranch(repo, originalBranch);
      notifier.notify(
        job.chatId,
        `⏱️ Timeout (${job.agentName}) su ${job.project.name} dopo ${Math.round(
          config.agentTimeoutMs / 1000
        )}s.\n` +
          (changed.length > 0
            ? `Modifiche parziali salvate in stash sul branch ${branch} ` +
              `(recupera con: git checkout ${branch} && git stash pop).\n\n`
            : `Nessuna modifica prodotta.\n\n`) +
          `Ultimo output:\n${tailLines(result.output, 30)}`
      );
      return;
    }

    if (!result.success) {
      const changed = await gitOps.getChangedFiles(repo);
      if (changed.length > 0) {
        await gitOps.stashChanges(repo, `savia-failed: ${job.intentSummary}`);
      }
      await gitOps.checkoutBranch(repo, originalBranch);
      notifier.notify(
        job.chatId,
        `❌ Esecuzione fallita (${job.agentName}) su ${job.project.name}.\n` +
          (changed.length > 0
            ? `Modifiche parziali salvate in stash sul branch ${branch} ` +
              `(recupera con: git checkout ${branch} && git stash pop).\n\n`
            : `Nessuna modifica prodotta.\n\n`) +
          `Errore/output:\n${tailLines(result.output || result.error || "", 30)}`
      );
      return;
    }

    const changed = await gitOps.getChangedFiles(repo);
    if (changed.length === 0) {
      await gitOps.checkoutBranch(repo, originalBranch);
      await gitOps.deleteBranch(repo, branch);
      notifier.notify(
        job.chatId,
        `✅ Completato (${job.agentName}) su ${job.project.name}, ma nessuna modifica ` +
          `prodotta.\nBranch ${branch} rimosso (vuoto).`
      );
      return;
    }

    await gitOps.commitChanges(repo, job.intentSummary);

    const pr = await pushAndOpenPr(job, branch, changed, ghUsable);

    await gitOps.checkoutBranch(repo, originalBranch);

    notifier.notify(
      job.chatId,
      buildCompletionMessage({
        project: job.project.name,
        branch,
        changed,
        pushOk: pr.pushOk,
        pushError: pr.pushError,
        prUrl: pr.prUrl,
        prError: pr.prError,
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log({ level: "error", event: "exec_pipeline_error", chatId: job.chatId, error: message });
    try {
      if (originalBranch) await gitOps.checkoutBranch(repo, originalBranch);
    } catch {
      // Ignora: il cleanup è best-effort.
    }
    notifier.notify(job.chatId, `⚠️ Errore imprevisto nel pipeline: ${message}`);
  }
}
