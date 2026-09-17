'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const agentDataPath = path.join(app.getPath('userData'), 'agent-data.json');

function load() {
  try {
    if (fs.existsSync(agentDataPath)) return JSON.parse(fs.readFileSync(agentDataPath, 'utf-8'));
  } catch (e) { /* ignore */ }
  return { calendar: [], todos: [], reminders: [] };
}

function save(data) {
  fs.writeFileSync(agentDataPath, JSON.stringify(data, null, 2), 'utf-8');
}

function persist() {
  save(load());
}

module.exports = { load, save, persist };