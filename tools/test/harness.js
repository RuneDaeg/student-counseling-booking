/** src/*.gs 를 한 덩어리로 읽어 가짜 Apps Script 환경에서 실행합니다. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildGlobals, formatDate, instantFromWall } = require('./gas-mock');

const SRC = path.join(__dirname, '..', '..', 'src');
const FILES = ['Config.gs', 'Setup.gs', 'Slots.gs', 'Reservation.gs', 'Calendar.gs', 'CalendarSync.gs', 'NotionSync.gs', 'Ai.gs', 'Code.gs'];

function loadApp(opts) {
  const state = buildGlobals(opts);
  const context = vm.createContext(state.globals);
  const code = FILES.map(function (f) {
    return '/* ==== ' + f + ' ==== */\n' + fs.readFileSync(path.join(SRC, f), 'utf8');
  }).join('\n');
  vm.runInContext(code, context, { filename: 'bundle.gs' });
  state.call = function (name, ...args) {
    return vm.runInContext('(' + name + ')', context)(...args);
  };
  return state;
}

/** 설정 시트의 한 항목을 바꿉니다. */
function setConfig(state, key, value) {
  const sheet = state.ss.getSheetByName('설정');
  const last = sheet.getLastRow();
  for (let r = 2; r <= last; r++) {
    if (String(sheet.getRange(r, 1).getValue()).trim() === key) {
      sheet.getRange(r, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value, '']);
}

/** 예약 시트를 사람이 보는 모습대로 읽습니다 (시트 시간대 기준 표시). */
function readBookingRows(state) {
  const sheet = state.ss.getSheetByName('예약');
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const out = [];
  for (let r = 2; r <= last; r++) {
    const values = sheet.getRange(r, 1, 1, sheet.getLastColumn()).getValues()[0];
    const obj = {};
    headers.forEach(function (h, i) {
      let v = values[i];
      if (v instanceof Date) v = { display: formatDate(v, state.ss.tz, 'yyyy-MM-dd HH:mm'), raw: v };
      obj[String(h)] = v;
    });
    out.push(obj);
  }
  return out;
}

module.exports = { loadApp, setConfig, readBookingRows, formatDate, instantFromWall };
