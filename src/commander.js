/**
 * S.A.V.I.A - Terminal Commander (Multi-Tab + Split Panes + xterm.js)
 * Warp-style terminal with PTY backend, command blocks, and voice control.
 */

(function () {
  'use strict';

  const Terminal = window.Terminal;
  const FitAddon = window.FitAddon;
  const WebLinksAddon = window.WebLinksAddon;

  if (!Terminal) {
    console.error('xterm.js not loaded');
    return;
  }

  // ── State ──────────────────────────────────────────────────────────
  const tabs = [];         // { id, name, panes: [{ id, ptyId, term, fitAddon, container }] }
  let activeTab = null;
  let activePane = null;   // { id, ptyId, term, fitAddon, container, tabId }
  let paneIdCounter = 0;
  let tabIdCounter = 0;

  // ── DOM refs ───────────────────────────────────────────────────────
  const tabBar = document.getElementById('tab-bar');
  const tabAddBtn = document.getElementById('btn-add-tab');
  const splitRoot = document.getElementById('split-root');
  const newTabBtn = document.getElementById('btn-new-tab');
  const closeTabBtn = document.getElementById('btn-close-tab');
  const splitHBtn = document.getElementById('btn-split-h');
  const splitVBtn = document.getElementById('btn-split-v');
  const paletteBtn = document.getElementById('btn-palette');
  const voiceCmdBtn = document.getElementById('btn-voice-cmd');
  const focusLeftBtn = document.getElementById('btn-focus-left');
  const focusRightBtn = document.getElementById('btn-focus-right');
  const focusUpBtn = document.getElementById('btn-focus-up');
  const focusDownBtn = document.getElementById('btn-focus-down');
  const paletteOverlay = document.getElementById('cmd-palette-overlay');
  const paletteInput = document.getElementById('cmd-palette-input');
  const paletteList = document.getElementById('cmd-palette-list');
  const statusTabs = document.getElementById('status-tabs');
  const statusPanes = document.getElementById('status-panes');
  const statusFocus = document.getElementById('status-focus');
  const statusCwd = document.getElementById('status-cwd');

  // ── xterm Theme ────────────────────────────────────────────────────
  const termTheme = {
    background: '#0a0c12',
    foreground: '#c4d1f5',
    cursor: '#00f3ff',
    cursorAccent: '#0a0c12',
    selectionBackground: 'rgba(0, 243, 255, 0.2)',
    black: '#1e2130',
    red: '#ff3c3c',
    green: '#00ff88',
    yellow: '#ffc800',
    blue: '#3c8cff',
    magenta: '#c678dd',
    cyan: '#00f3ff',
    white: '#c4d1f5',
    brightBlack: '#555e7a',
    brightRed: '#ff6b6b',
    brightGreen: '#4cff9f',
    brightYellow: '#ffe066',
    brightBlue: '#6cb4ff',
    brightMagenta: '#d9a0ec',
    brightCyan: '#66f7ff',
    brightWhite: '#eef1f8'
  };

  // ── Terminal Factory ───────────────────────────────────────────────
  function createTerminalInstance() {
    const term = new Terminal({
      theme: termTheme,
      fontFamily: '"Share Tech Mono", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      scrollback: 10000,
      convertEol: true,
      allowTransparency: true,
    });
    const fitAddon = new FitAddon.FitAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    return { term, fitAddon };
  }

  // ── Tab Management ─────────────────────────────────────────────────
  function createTab(name) {
    const tabId = 'tab-' + (++tabIdCounter);
    const tab = { id: tabId, name: name || 'Terminal ' + tabIdCounter, panes: [] };

    tabs.push(tab);
    renderTabBar();

    // Create root split container for this tab
    const splitContainer = document.createElement('div');
    splitContainer.className = 'split-container horizontal';
    splitContainer.dataset.tabId = tabId;
    splitContainer.style.display = 'none';
    splitRoot.appendChild(splitContainer);

    tab.splitContainer = splitContainer;

    // Create first pane
    createPane(tab, splitContainer);

    switchTab(tabId);
    updateStatus();
    return tab;
  }

  function closeTab(tabId) {
    const idx = tabs.findIndex(t => t.id === tabId);
    if (idx < 0) return;

    const tab = tabs[idx];
    // Kill all PTYs in this tab
    tab.panes.forEach(p => destroyPane(p));

    if (tab.splitContainer) tab.splitContainer.remove();
    tabs.splice(idx, 1);
    renderTabBar();

    if (tabs.length === 0) {
      createTab();
    } else if (activeTab && activeTab.id === tabId) {
      switchTab(tabs[Math.min(idx, tabs.length - 1)].id);
    }
    updateStatus();
  }

  function switchTab(tabId) {
    tabs.forEach(t => {
      if (t.splitContainer) t.splitContainer.style.display = t.id === tabId ? 'flex' : 'none';
    });
    activeTab = tabs.find(t => t.id === tabId);
    renderTabBar();

    if (activeTab && activeTab.panes.length > 0) {
      focusPane(activeTab.panes[0]);
    }
    updateStatus();
  }

  function renderTabBar() {
    const addBtn = tabBar.querySelector('.term-tab-add');
    tabBar.querySelectorAll('.term-tab').forEach(el => el.remove());

    tabs.forEach(tab => {
      const el = document.createElement('div');
      el.className = 'term-tab' + (activeTab && activeTab.id === tab.id ? ' active' : '');
      el.dataset.tabId = tab.id;

      const label = document.createElement('span');
      label.textContent = tab.name;
      el.appendChild(label);

      const close = document.createElement('span');
      close.className = 'tab-close';
      close.innerHTML = '<i class="fas fa-times"></i>';
      close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });
      el.appendChild(close);

      el.addEventListener('click', () => switchTab(tab.id));
      tabBar.insertBefore(el, addBtn);
    });
  }

  // ── Pane Management ────────────────────────────────────────────────
  function createPane(tab, parentContainer, afterPane) {
    const paneId = 'pane-' + (++paneIdCounter);
    const { term, fitAddon } = createTerminalInstance();

    const pane = {
      id: paneId,
      ptyId: null,
      term,
      fitAddon,
      container: null,
      tabId: tab.id
    };

    // Build pane DOM
    const paneEl = document.createElement('div');
    paneEl.className = 'split-pane';
    paneEl.dataset.paneId = paneId;

    const header = document.createElement('div');
    header.className = 'pane-header';
    header.innerHTML = `
      <span class="pane-header-title">${tab.name} // ${paneIdCounter}</span>
      <div class="pane-header-actions">
        <button class="pane-action-btn" data-action="split-h" title="Split Horizontal"><i class="fas fa-arrows-alt-h"></i></button>
        <button class="pane-action-btn" data-action="split-v" title="Split Vertical"><i class="fas fa-arrows-alt-v"></i></button>
        <button class="pane-action-btn" data-action="close" title="Close Pane"><i class="fas fa-times"></i></button>
      </div>
    `;

    const termContainer = document.createElement('div');
    termContainer.className = 'xterm-container';

    paneEl.appendChild(header);
    paneEl.appendChild(termContainer);
    pane.container = paneEl;

    // Insert into parent
    if (afterPane && afterPane.container && afterPane.container.parentNode) {
      const divider = document.createElement('div');
      divider.className = 'split-divider';
      afterPane.container.parentNode.insertBefore(divider, afterPane.container.nextSibling);
      afterPane.container.parentNode.insertBefore(paneEl, divider.nextSibling);
    } else {
      parentContainer.appendChild(paneEl);
    }

    // Attach xterm
    term.open(termContainer);
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    // Pane header actions
    header.querySelector('[data-action="split-h"]').addEventListener('click', () => {
      splitPane(pane, 'horizontal');
    });
    header.querySelector('[data-action="split-v"]').addEventListener('click', () => {
      splitPane(pane, 'vertical');
    });
    header.querySelector('[data-action="close"]').addEventListener('click', () => {
      destroyPane(pane);
      const tab = tabs.find(t => t.id === pane.tabId);
      if (tab) {
        tab.panes = tab.panes.filter(p => p.id !== pane.id);
        if (tab.panes.length === 0) closeTab(tab.id);
        else if (activePane && activePane.id === pane.id) focusPane(tab.panes[0]);
      }
      updateStatus();
    });

    // Focus on click
    paneEl.addEventListener('mousedown', () => focusPane(pane));

    // Create PTY
    createPtyForPane(pane);

    tab.panes.push(pane);
    updateStatus();
    return pane;
  }

  function destroyPane(pane) {
    if (pane.ptyId && window.electronAPI) {
      window.electronAPI.terminalPtyKill(pane.ptyId).catch(() => {});
    }
    if (pane.term) {
      try { pane.term.dispose(); } catch (e) {}
    }
    if (pane.container) {
      // Remove adjacent divider too
      const prev = pane.container.previousElementSibling;
      const next = pane.container.nextElementSibling;
      if (prev && prev.classList.contains('split-divider')) prev.remove();
      if (next && next.classList.contains('split-divider')) next.remove();
      pane.container.remove();
    }
  }

  async function createPtyForPane(pane) {
    if (!window.electronAPI || !window.electronAPI.terminalPtyCreate) return;

    const cols = pane.term.cols || 120;
    const rows = pane.term.rows || 30;

    const result = await window.electronAPI.terminalPtyCreate({ cols, rows });
    if (result.success) {
      pane.ptyId = result.ptyId;

      // Write handler: xterm -> PTY
      pane.term.onData((data) => {
        if (pane.ptyId && window.electronAPI) {
          window.electronAPI.terminalPtyWrite(pane.ptyId, data);
        }
      });

      // Resize handler
      pane.term.onResize(({ cols, rows }) => {
        if (pane.ptyId && window.electronAPI) {
          window.electronAPI.terminalPtyResize(pane.ptyId, cols, rows);
        }
      });

      focusPane(pane);
    }
  }

  // ── Split Panes ────────────────────────────────────────────────────
  function splitPane(sourcePane, direction) {
    const tab = tabs.find(t => t.id === sourcePane.tabId);
    if (!tab) return;

    const parentContainer = sourcePane.container.parentNode;
    parentContainer.classList.remove('horizontal', 'vertical');
    parentContainer.classList.add(direction === 'horizontal' ? 'horizontal' : 'vertical');

    const newPane = createPane(tab, parentContainer, sourcePane);

    // Add resize divider drag
    setupDividerDrag(sourcePane, newPane, parentContainer);

    // Refit both
    setTimeout(() => {
      sourcePane.fitAddon.fit();
      newPane.fitAddon.fit();
      focusPane(sourcePane);
    }, 50);
  }

  function setupDividerDrag(paneA, paneB, container) {
    const divider = paneA.container.nextElementSibling;
    if (!divider || !divider.classList.contains('split-divider')) return;

    let startPos, startSizeA, startSizeB;
    const isHorizontal = container.classList.contains('horizontal');

    divider.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startPos = isHorizontal ? e.clientX : e.clientY;
      startSizeA = isHorizontal ? paneA.container.offsetWidth : paneA.container.offsetHeight;
      startSizeB = isHorizontal ? paneB.container.offsetWidth : paneB.container.offsetHeight;

      const onMouseMove = (e) => {
        const delta = (isHorizontal ? e.clientX : e.clientY) - startPos;
        const totalSize = startSizeA + startSizeB;
        const newA = Math.max(200, Math.min(totalSize - 200, startSizeA + delta));
        const newB = totalSize - newA;
        const pctA = (newA / totalSize * 100).toFixed(2);
        const pctB = (newB / totalSize * 100).toFixed(2);

        paneA.container.style.flex = `0 0 ${pctA}%`;
        paneB.container.style.flex = `0 0 ${pctB}%`;

        paneA.fitAddon.fit();
        paneB.fitAddon.fit();
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  // ── Focus Management ───────────────────────────────────────────────
  function focusPane(pane) {
    if (!pane || !pane.term) return;
    activePane = pane;
    pane.term.focus();
    updateStatus();

    // Update pane header highlight
    document.querySelectorAll('.split-pane').forEach(p => p.style.outline = 'none');
    if (pane.container) pane.container.style.outline = '1px solid rgba(0, 243, 255, 0.3)';
  }

  function focusPaneRelative(direction) {
    if (!activePane || !activeTab) return;
    const panes = activeTab.panes;
    const idx = panes.indexOf(activePane);
    if (idx < 0) return;

    // Simple: find closest pane in the direction
    // For now, cycle through panes
    let nextIdx;
    if (direction === 'right' || direction === 'down') {
      nextIdx = (idx + 1) % panes.length;
    } else {
      nextIdx = (idx - 1 + panes.length) % panes.length;
    }
    focusPane(panes[nextIdx]);
  }

  // ── Status Bar ─────────────────────────────────────────────────────
  function updateStatus() {
    statusTabs.textContent = 'TABS: ' + tabs.length;
    let totalPanes = 0;
    tabs.forEach(t => totalPanes += t.panes.length);
    statusPanes.textContent = 'PANES: ' + totalPanes;

    if (activePane) {
      statusFocus.textContent = 'FOCUS: ' + activePane.id;
      if (activePane.ptyId && window.electronAPI) {
        window.electronAPI.terminalPtyCwd(activePane.ptyId).then(r => {
          if (r.success) statusCwd.textContent = 'CWD: ' + r.cwd;
        }).catch(() => {});
      }
    } else {
      statusFocus.textContent = 'FOCUS: —';
      statusCwd.textContent = 'CWD: —';
    }
  }

  // ── Command Palette ────────────────────────────────────────────────
  const commands = [
    { icon: 'fa-plus', label: 'New Tab', shortcut: 'Ctrl+T', action: () => createTab() },
    { icon: 'fa-times', label: 'Close Tab', shortcut: 'Ctrl+W', action: () => { if (activeTab) closeTab(activeTab.id); } },
    { icon: 'fa-arrows-alt-h', label: 'Split Horizontal', shortcut: '', action: () => { if (activePane) splitPane(activePane, 'horizontal'); } },
    { icon: 'fa-arrows-alt-v', label: 'Split Vertical', shortcut: '', action: () => { if (activePane) splitPane(activePane, 'vertical'); } },
    { icon: 'fa-chevron-left', label: 'Focus Left', shortcut: 'Alt+←', action: () => focusPaneRelative('left') },
    { icon: 'fa-chevron-right', label: 'Focus Right', shortcut: 'Alt+→', action: () => focusPaneRelative('right') },
    { icon: 'fa-chevron-up', label: 'Focus Up', shortcut: 'Alt+↑', action: () => focusPaneRelative('up') },
    { icon: 'fa-chevron-down', label: 'Focus Down', shortcut: 'Alt+↓', action: () => focusPaneRelative('down') },
    { icon: 'fa-folder-open', label: 'Open in Explorer', shortcut: '', action: () => openCurrentDirInExplorer() },
    { icon: 'fa-trash-alt', label: 'Clear Pane', shortcut: '', action: () => { if (activePane && activePane.term) activePane.term.clear(); } },
  ];

  function openCurrentDirInExplorer() {
    if (activePane && activePane.ptyId && window.electronAPI) {
      window.electronAPI.terminalPtyCwd(activePane.ptyId).then(r => {
        if (r.success && window.electronAPI.openInExplorer) {
          window.electronAPI.openInExplorer(r.cwd);
        }
      }).catch(() => {});
    }
  }

  function showPalette() {
    paletteOverlay.classList.add('visible');
    paletteInput.value = '';
    renderPaletteList('');
    paletteInput.focus();
  }

  function hidePalette() {
    paletteOverlay.classList.remove('visible');
  }

  function renderPaletteList(filter) {
    paletteList.innerHTML = '';
    const filtered = commands.filter(c =>
      c.label.toLowerCase().includes(filter.toLowerCase())
    );
    filtered.forEach((cmd, i) => {
      const el = document.createElement('div');
      el.className = 'cmd-palette-item' + (i === 0 ? ' selected' : '');
      el.innerHTML = `
        <span class="cmd-icon"><i class="fas ${cmd.icon}"></i></span>
        <span class="cmd-label">${cmd.label}</span>
        ${cmd.shortcut ? `<span class="cmd-shortcut">${cmd.shortcut}</span>` : ''}
      `;
      el.addEventListener('click', () => { hidePalette(); cmd.action(); });
      paletteList.appendChild(el);
    });
  }

  paletteInput.addEventListener('input', () => renderPaletteList(paletteInput.value));
  paletteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hidePalette(); return; }
    if (e.key === 'Enter') {
      const selected = paletteList.querySelector('.selected');
      if (selected) selected.click();
      return;
    }
    const items = paletteList.querySelectorAll('.cmd-palette-item');
    let idx = -1;
    items.forEach((el, i) => { if (el.classList.contains('selected')) idx = i; });
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items.forEach(el => el.classList.remove('selected'));
      idx = (idx + 1) % items.length;
      if (items[idx]) items[idx].classList.add('selected');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items.forEach(el => el.classList.remove('selected'));
      idx = (idx - 1 + items.length) % items.length;
      if (items[idx]) items[idx].classList.add('selected');
    }
  });

  paletteOverlay.addEventListener('click', (e) => {
    if (e.target === paletteOverlay) hidePalette();
  });

  // ── PTY Data Router ────────────────────────────────────────────────
  if (window.electronAPI && window.electronAPI.onTerminalPtyData) {
    window.electronAPI.onTerminalPtyData((data) => {
      const pane = findPaneByPtyId(data.ptyId);
      if (!pane || !pane.term) return;

      if (data.type === 'data') {
        pane.term.write(data.data);
      } else if (data.type === 'exit') {
        pane.term.write('\r\n\x1b[38;5;245m[Process exited with code ' + data.data + ']\x1b[0m\r\n');
      }
    });
  }

  function findPaneByPtyId(ptyId) {
    for (const tab of tabs) {
      for (const pane of tab.panes) {
        if (pane.ptyId === ptyId) return pane;
      }
    }
    return null;
  }

  // ── Resize Observer ────────────────────────────────────────────────
  const resizeObserver = new ResizeObserver(() => {
    if (activePane && activePane.fitAddon) {
      try { activePane.fitAddon.fit(); } catch (e) {}
    }
  });
  resizeObserver.observe(splitRoot);

  window.addEventListener('resize', () => {
    tabs.forEach(tab => {
      tab.panes.forEach(p => {
        if (p.fitAddon) {
          try { p.fitAddon.fit(); } catch (e) {}
        }
      });
    });
  });

  // ── Keyboard Shortcuts ─────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    // Ctrl+T: new tab
    if (e.ctrlKey && e.key === 't') {
      e.preventDefault();
      createTab();
    }
    // Ctrl+W: close tab
    if (e.ctrlKey && e.key === 'w') {
      e.preventDefault();
      if (activeTab) closeTab(activeTab.id);
    }
    // Ctrl+Shift+P: command palette
    if (e.ctrlKey && e.shiftKey && e.key === 'P') {
      e.preventDefault();
      showPalette();
    }
    // Ctrl+Shift+H: split horizontal
    if (e.ctrlKey && e.shiftKey && e.key === 'H') {
      e.preventDefault();
      if (activePane) splitPane(activePane, 'horizontal');
    }
    // Ctrl+Shift+V: split vertical (note: may conflict with paste in some contexts)
    if (e.ctrlKey && e.shiftKey && e.key === 'J') {
      e.preventDefault();
      if (activePane) splitPane(activePane, 'vertical');
    }
    // Alt+Arrow: focus navigation
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); focusPaneRelative('left'); }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); focusPaneRelative('right'); }
    if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); focusPaneRelative('up'); }
    if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); focusPaneRelative('down'); }
    // Ctrl+Tab / Ctrl+Shift+Tab: switch tabs
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      if (activeTab) {
        const idx = tabs.indexOf(activeTab);
        const nextIdx = e.shiftKey ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
        switchTab(tabs[nextIdx].id);
      }
    }
    // Escape: close palette
    if (e.key === 'Escape') {
      hidePalette();
    }
  });

  // ── Button Handlers ────────────────────────────────────────────────
  newTabBtn.addEventListener('click', () => createTab());
  tabAddBtn.addEventListener('click', () => createTab());
  closeTabBtn.addEventListener('click', () => { if (activeTab) closeTab(activeTab.id); });
  splitHBtn.addEventListener('click', () => { if (activePane) splitPane(activePane, 'horizontal'); });
  splitVBtn.addEventListener('click', () => { if (activePane) splitPane(activePane, 'vertical'); });
  paletteBtn.addEventListener('click', showPalette);
  focusLeftBtn.addEventListener('click', () => focusPaneRelative('left'));
  focusRightBtn.addEventListener('click', () => focusPaneRelative('right'));
  focusUpBtn.addEventListener('click', () => focusPaneRelative('up'));
  focusDownBtn.addEventListener('click', () => focusPaneRelative('down'));

  // Voice command button (integrates with voice-control.js if loaded)
  voiceCmdBtn.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('savia-terminal-voice-request'));
  });

  // ── Init ───────────────────────────────────────────────────────────
  createTab('Terminal 1');

  // Window controls
  const btnMin = document.getElementById('btn-minimize');
  const btnMax = document.getElementById('btn-maximize');
  const btnClose = document.getElementById('btn-close');
  if (btnMin) btnMin.addEventListener('click', () => window.electronAPI && window.electronAPI.minimize());
  if (btnMax) btnMax.addEventListener('click', () => window.electronAPI && window.electronAPI.maximize());
  if (btnClose) btnClose.addEventListener('click', () => window.electronAPI && window.electronAPI.close());

  // ── Voice Control Integration ──────────────────────────────────────
  // Listen for voice commands via IPC (cross-window from index.html)
  if (window.electronAPI && window.electronAPI.onTerminalVoiceCommand) {
    window.electronAPI.onTerminalVoiceCommand((action) => {
      if (!action || !action.type) return;
      handleTerminalVoiceAction(action);
    });
  }

  // Also listen for local custom events (same window)
  document.addEventListener('savia-terminal-execute', (e) => {
    const cmd = e.detail && e.detail.command;
    if (cmd) handleTerminalVoiceAction({ type: 'execute', command: cmd });
  });

  function handleTerminalVoiceAction(action) {
    switch (action.type) {
      case 'execute':
        if (action.command && activePane && activePane.ptyId && window.electronAPI) {
          window.electronAPI.terminalPtyWrite(activePane.ptyId, action.command + '\n');
        }
        break;
      case 'new-tab':
        createTab();
        break;
      case 'close-tab':
        if (activeTab) closeTab(activeTab.id);
        break;
      case 'split-h':
        if (activePane) splitPane(activePane, 'horizontal');
        break;
      case 'split-v':
        if (activePane) splitPane(activePane, 'vertical');
        break;
      case 'next-tab':
        if (activeTab) {
          const idx = tabs.findIndex(t => t.id === activeTab.id);
          if (idx >= 0 && idx < tabs.length - 1) switchTab(tabs[idx + 1].id);
        }
        break;
      case 'prev-tab':
        if (activeTab) {
          const idx2 = tabs.findIndex(t => t.id === activeTab.id);
          if (idx2 > 0) switchTab(tabs[idx2 - 1].id);
        }
        break;
      case 'focus-next':
        focusPaneRelative('right');
        break;
      case 'focus-prev':
        focusPaneRelative('left');
        break;
      case 'focus-up':
        focusPaneRelative('up');
        break;
      case 'focus-down':
        focusPaneRelative('down');
        break;
      case 'kill':
        if (activePane && activePane.ptyId && window.electronAPI) {
          window.electronAPI.terminalPtyKill(activePane.ptyId);
        }
        break;
      case 'clear':
        if (activePane && activePane.term) activePane.term.clear();
        break;
      case 'open-explorer':
        openCurrentDirInExplorer();
        break;
    }
  }

  document.addEventListener('savia-terminal-new-tab', () => createTab());
  document.addEventListener('savia-terminal-close-tab', () => { if (activeTab) closeTab(activeTab.id); });
  document.addEventListener('savia-terminal-split-h', () => { if (activePane) splitPane(activePane, 'horizontal'); });
  document.addEventListener('savia-terminal-split-v', () => { if (activePane) splitPane(activePane, 'vertical'); });
  document.addEventListener('savia-terminal-focus-next', () => focusPaneRelative('right'));
  document.addEventListener('savia-terminal-focus-prev', () => focusPaneRelative('left'));
  document.addEventListener('savia-terminal-focus-up', () => focusPaneRelative('up'));
  document.addEventListener('savia-terminal-focus-down', () => focusPaneRelative('down'));
  document.addEventListener('savia-terminal-clear', () => {
    if (activePane && activePane.term) activePane.term.clear();
  });
  document.addEventListener('savia-terminal-open-explorer', () => openCurrentDirInExplorer());
  document.addEventListener('savia-terminal-voice-request', () => {
    // Trigger voice capture from terminal page
    document.dispatchEvent(new CustomEvent('savia-terminal-voice-request'));
  });

})();
