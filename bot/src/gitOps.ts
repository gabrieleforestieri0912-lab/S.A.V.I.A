import simpleGit, { SimpleGit } from "simple-git";

function git(repoPath: string): SimpleGit {
  return simpleGit(repoPath);
}

export async function isWorkingTreeClean(repoPath: string): Promise<boolean> {
  const status = await git(repoPath).status();
  return status.files.length === 0;
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const status = await git(repoPath).status();
  return status.current ?? "HEAD";
}

export async function createBranch(repoPath: string, branch: string): Promise<void> {
  await git(repoPath).checkoutLocalBranch(branch);
}

export async function checkoutBranch(repoPath: string, branch: string): Promise<void> {
  await git(repoPath).checkout(branch);
}

export async function commitChanges(repoPath: string, message: string): Promise<void> {
  const g = git(repoPath);
  await g.add(".");
  await g.commit(message);
}

export async function getChangedFiles(repoPath: string): Promise<string[]> {
  const status = await git(repoPath).status();
  return status.files.map((f) => f.path);
}

export async function stashChanges(repoPath: string, message: string): Promise<void> {
  await git(repoPath).stash(["push", "-u", "-m", message]);
}

export async function deleteBranch(repoPath: string, branch: string): Promise<void> {
  await git(repoPath).deleteLocalBranch(branch, true);
}

export async function pushBranch(repoPath: string, branch: string): Promise<void> {
  await git(repoPath).push("origin", branch, ["-u"]);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function makeBranchName(intentSummary: string): string {
  const d = new Date();
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

  const slug = intentSummary
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 4)
    .join("-");

  const safeSlug = slug || "task";
  return `savia/${stamp}-${safeSlug}`;
}
