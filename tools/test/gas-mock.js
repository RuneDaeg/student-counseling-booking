/**
 * Apps Script(구글 시트) 환경을 흉내 내는 최소 구현.
 * 날짜/시간대 동작을 실제와 최대한 비슷하게 맞추는 것이 목적입니다.
 *
 * 재현하는 실제 동작
 *  - 시트는 값을 '날짜 일련번호'로 저장하고, getValues() 는 스프레드시트 시간대 기준
 *    자정의 Date 객체로 돌려줍니다.
 *  - setValue/appendRow 에 문자열을 넣으면 사용자가 타이핑한 것처럼 해석됩니다
 *    (숫자 서식이 '@' 인 칸은 글자 그대로).
 *  - Date 객체를 넣으면 스프레드시트 시간대로 변환해 저장됩니다.
 */

/* ---------- 시간대 유틸 ---------- */

function wallParts(tz, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour) % 24, minute: Number(p.minute), second: Number(p.second)
  };
}

function tzOffsetMs(tz, date) {
  const p = wallParts(tz, date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** 그 시간대의 '벽시계 시각' → 실제 순간(Date) */
function instantFromWall(tz, y, mo, d, h, mi, s) {
  const target = Date.UTC(y, mo - 1, d, h || 0, mi || 0, s || 0);
  let ts = target;
  for (let i = 0; i < 4; i++) {
    const next = target - tzOffsetMs(tz, new Date(ts));
    if (next === ts) break;
    ts = next;
  }
  return new Date(ts);
}

function pad(n, len) { return String(n).padStart(len, '0'); }

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDate(date, tz, fmt) {
  const p = wallParts(tz, date);
  const offMin = tzOffsetMs(tz, date) / 60000;
  const sign = offMin < 0 ? '-' : '+';
  const abs = Math.abs(offMin);
  const xxx = sign + pad(Math.floor(abs / 60), 2) + ':' + pad(abs % 60, 2);
  const dowIdx = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();

  return fmt.replace(/'([^']*)'|yyyy|yy|MM|M|dd|d|HH|H|mm|m|ss|s|XXX|EEE/g, function (token, quoted) {
    if (quoted !== undefined) return quoted;
    switch (token) {
      case 'yyyy': return pad(p.year, 4);
      case 'yy': return pad(p.year % 100, 2);
      case 'MM': return pad(p.month, 2);
      case 'M': return String(p.month);
      case 'dd': return pad(p.day, 2);
      case 'd': return String(p.day);
      case 'HH': return pad(p.hour, 2);
      case 'H': return String(p.hour);
      case 'mm': return pad(p.minute, 2);
      case 'm': return String(p.minute);
      case 'ss': return pad(p.second, 2);
      case 's': return String(p.second);
      case 'XXX': return xxx;
      case 'EEE': return DOW_SHORT[dowIdx];
      default: return token;
    }
  });
}

function parseDate(str, tz, fmt) {
  if (fmt !== 'yyyy-MM-dd HH:mm') throw new Error('mock: 지원하지 않는 형식 ' + fmt);
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2})$/);
  if (!m) throw new Error('mock: 파싱 실패 ' + str);
  return instantFromWall(tz, +m[1], +m[2], +m[3], +m[4], +m[5], 0);
}

/* ---------- 시트 모델 ---------- */

const DATE_TEXT = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const TIME_TEXT = /^(\d{1,2}):(\d{2})$/;

class Cell {
  constructor() { this.value = ''; this.format = ''; }
}

class MockRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet; this.row = row; this.col = col;
    this.numRows = numRows; this.numCols = numCols;
  }
  _cell(r, c) { return this.sheet._cell(this.row + r, this.col + c); }
  getRow() { return this.row; }
  getNumRows() { return this.numRows; }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) line.push(this.sheet._read(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  getDisplayValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) line.push(this.sheet._display(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  getDisplayValue() { return this.getDisplayValues()[0][0]; }
  setValues(values) {
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        this.sheet._write(this.row + r, this.col + c, values[r][c]);
      }
    }
    return this;
  }
  setValue(v) {
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) this.sheet._write(this.row + r, this.col + c, v);
    }
    return this;
  }
  setNumberFormat(fmt) {
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) this._cell(r, c).format = fmt;
    }
    return this;
  }
  getNumberFormat() { return this._cell(0, 0).format; }
  clearContent() { return this.setValue(''); }
  // 서식 관련은 동작에 영향이 없으므로 무시합니다.
  merge() { return this; }
  breakApart() { return this; }
  setWrap() { return this; }
  setFontWeight() { return this; }
  setFontSize() { return this; }
  setFontColor() { return this; }
  setBackground() { return this; }
  setBackgrounds() { return this; }
  setHorizontalAlignment() { return this; }
  setVerticalAlignment() { return this; }
  setBorder() { return this; }
  setNote() { return this; }
  setDataValidation() { return this; }
  setRichTextValue() { return this; }
}

class MockSheet {
  constructor(ss, name) {
    this.ss = ss; this.name = name;
    this.cells = [];            // cells[row][col], 1-based
    this.maxRows = 1000;
    this.maxCols = 26;
  }
  _cell(row, col) {
    if (!this.cells[row]) this.cells[row] = [];
    if (!this.cells[row][col]) this.cells[row][col] = new Cell();
    return this.cells[row][col];
  }
  /** 시트에 실제로 담기는 형태로 바꿉니다 (사용자가 타이핑한 것처럼) */
  _write(row, col, value) {
    const cell = this._cell(row, col);
    if (value instanceof Date) {
      cell.value = { kind: 'datetime', ms: value.getTime() };
      return;
    }
    const s = typeof value === 'string' ? value.trim() : value;
    if (typeof s === 'string' && cell.format !== '@') {
      const dm = s.match(DATE_TEXT);
      if (dm) {
        const inst = instantFromWall(this.ss.tz, +dm[1], +dm[2], +dm[3], 0, 0, 0);
        cell.value = { kind: 'date', ms: inst.getTime() };
        return;
      }
      const tm = s.match(TIME_TEXT);
      if (tm) {
        // 시트는 시각만 있는 값을 1899-12-30 기준으로 담습니다.
        const inst = instantFromWall(this.ss.tz, 1899, 12, 30, +tm[1], +tm[2], 0);
        cell.value = { kind: 'time', ms: inst.getTime() };
        return;
      }
    }
    cell.value = value === undefined || value === null ? '' : value;
  }
  _read(row, col) {
    const v = this._cell(row, col).value;
    if (v && typeof v === 'object' && v.kind) {
      if (v.kind === 'datetime') return new Date(v.ms);
      // 시트는 날짜를 '일련번호'로만 담습니다. JS Date 로 바꿀 때 어느 시간대의
      // 자정으로 볼지는 환경마다 다를 수 있어, 두 가지 모두 시험합니다.
      const tz = this.ss.dateReadTz === 'script' ? this.ss.scriptTz : this.ss.tz;
      const p = wallParts(this.ss.tz, new Date(v.ms));
      return instantFromWall(tz, p.year, p.month, p.day, p.hour, p.minute, p.second);
    }
    return v;
  }
  /** 셀에 보이는 글자 (숫자 서식을 적용한 결과) */
  _display(row, col) {
    const cell = this._cell(row, col);
    const v = cell.value;
    if (v && typeof v === 'object' && v.kind) {
      const fmt = cell.format || 'yyyy-mm-dd';
      const d = new Date(v.ms);
      if (fmt === '@') return String(Math.round((v.ms - Date.UTC(1899, 11, 30)) / 86400000));
      const useTime = fmt.indexOf('hh') >= 0;
      return formatDate(d, this.ss.tz, useTime ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
    }
    return v === undefined || v === null ? '' : String(v);
  }
  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  getLastRow() {
    let last = 0;
    for (let r = 1; r < this.cells.length; r++) {
      const line = this.cells[r] || [];
      for (let c = 1; c < line.length; c++) {
        if (line[c] && line[c].value !== '' && line[c].value !== undefined) { last = Math.max(last, r); break; }
      }
    }
    return last;
  }
  getLastColumn() {
    let last = 0;
    for (let r = 1; r < this.cells.length; r++) {
      const line = this.cells[r] || [];
      for (let c = 1; c < line.length; c++) {
        if (line[c] && line[c].value !== '' && line[c].value !== undefined) last = Math.max(last, c);
      }
    }
    return last;
  }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = a.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
      const colOf = function (s) {
        let n = 0;
        for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
        return n;
      };
      const r1 = Number(m[2]), c1 = colOf(m[1]);
      const r2 = m[4] ? Number(m[4]) : r1, c2 = m[3] ? colOf(m[3]) : c1;
      return new MockRange(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    return new MockRange(this, a, b, c === undefined ? 1 : c, d === undefined ? 1 : d);
  }
  appendRow(values) {
    const row = this.getLastRow() + 1;
    this.maxRows = Math.max(this.maxRows, row);
    for (let c = 0; c < values.length; c++) this._write(row, c + 1, values[c]);
    return this;
  }
  deleteRow(row) {
    this.cells.splice(row, 1);
    return this;
  }
  clear() { this.cells = []; return this; }
  setColumnWidth() { return this; }
  setRowHeight() { return this; }
  setFrozenRows() { return this; }
  setFrozenColumns() { return this; }
  setHiddenGridlines() { return this; }
  hideColumns() { return this; }
  getConditionalFormatRules() { return []; }
  setConditionalFormatRules() { return this; }
  getActiveRangeList() { return { getRanges: function () { return []; } }; }
}

class MockSpreadsheet {
  constructor(tz, opts) {
    this.tz = tz;
    this.scriptTz = (opts && opts.scriptTz) || tz;
    this.dateReadTz = (opts && opts.dateReadTz) || 'sheet';
    this.sheets = [];
  }
  getSpreadsheetTimeZone() { return this.tz; }
  setSpreadsheetTimeZone(tz) { this.tz = tz; return this; }
  getSheetByName(name) { return this.sheets.filter(function (s) { return s.getName() === name; })[0] || null; }
  insertSheet(name) { const s = new MockSheet(this, name); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
  toast() { }
}

/* ---------- 전역 객체 만들기 ---------- */

function buildGlobals(opts) {
  const ss = new MockSpreadsheet(opts.spreadsheetTz, {
    scriptTz: opts.scriptTz || 'Asia/Seoul',
    dateReadTz: opts.dateReadTz || 'sheet'
  });
  const state = {
    ss: ss,
    now: opts.now,                 // Date
    scriptTz: opts.scriptTz || 'Asia/Seoul',
    mails: [],
    calendarEvents: [],
    triggers: [],
    props: {},
    logs: []
  };

  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(state.now.getTime());
      else super(...args);
    }
    static now() { return state.now.getTime(); }
  }

  const g = {
    console: {
      log: function () { state.logs.push(Array.from(arguments).join(' ')); },
      error: function () { state.logs.push('ERROR ' + Array.from(arguments).join(' ')); },
      warn: function () { state.logs.push('WARN ' + Array.from(arguments).join(' ')); }
    },
    Date: FakeDate,
    Math: Math,
    JSON: JSON,
    String: String,
    Number: Number,
    Object: Object,
    Array: Array,
    Error: Error,
    isNaN: isNaN,
    parseInt: parseInt,
    parseFloat: parseFloat,
    RegExp: RegExp,
    Intl: Intl,

    SpreadsheetApp: {
      getActiveSpreadsheet: function () { return ss; },
      getActive: function () { return ss; },
      getActiveSheet: function () { return ss.getSheets()[0]; },
      openById: function () { return ss; },
      flush: function () { },
      getUi: function () {
        return {
          createMenu: function () {
            const menu = { addItem: function () { return menu; }, addSeparator: function () { return menu; }, addToUi: function () { } };
            return menu;
          },
          alert: function (msg) { state.logs.push('ALERT ' + msg); },
          prompt: function () { return { getSelectedButton: function () { return null; }, getResponseText: function () { return ''; } }; },
          ButtonSet: { OK_CANCEL: 'OK_CANCEL' },
          Button: { OK: 'OK' }
        };
      },
      newDataValidation: function () {
        const b = { requireValueInList: function () { return b; }, build: function () { return {}; } };
        return b;
      },
      newConditionalFormatRule: function () {
        const b = {
          whenFormulaSatisfied: function () { return b; },
          setBackground: function () { return b; },
          setRanges: function () { return b; },
          build: function () { return {}; }
        };
        return b;
      },
      newRichTextValue: function () {
        const b = { setText: function () { return b; }, setTextStyle: function () { return b; }, build: function () { return {}; } };
        return b;
      },
      newTextStyle: function () {
        const b = {
          setBold: function () { return b; }, setFontSize: function () { return b; },
          setForegroundColor: function () { return b; }, build: function () { return {}; }
        };
        return b;
      },
      BorderStyle: { SOLID: 'SOLID' }
    },

    Utilities: {
      formatDate: function (date, tz, fmt) { return formatDate(date, tz, fmt); },
      parseDate: function (str, tz, fmt) { return parseDate(str, tz, fmt); }
    },

    Session: {
      getScriptTimeZone: function () { return state.scriptTz; },
      getEffectiveUser: function () { return { getEmail: function () { return 'teacher@example.com'; } }; }
    },

    LockService: {
      getScriptLock: function () { return { waitLock: function () { }, releaseLock: function () { } }; }
    },

    PropertiesService: {
      getScriptProperties: function () {
        return {
          getProperty: function (k) { return state.props[k] || null; },
          setProperty: function (k, v) { state.props[k] = v; },
          deleteProperty: function (k) { delete state.props[k]; }
        };
      }
    },

    MailApp: {
      sendEmail: function (o) { state.mails.push(o); }
    },

    ScriptApp: {
      getProjectTriggers: function () { return state.triggers; },
      deleteTrigger: function () { },
      newTrigger: function (fn) {
        const b = {
          timeBased: function () { return b; },
          after: function () { return b; },
          everyMinutes: function () { return b; },
          create: function () {
            state.triggers.push({ getHandlerFunction: function () { return fn; }, getUniqueId: function () { return fn; } });
          }
        };
        return b;
      },
      getService: function () { return { getUrl: function () { return 'https://example.com/exec'; } }; }
    },

    CalendarApp: {
      Color: { BLUE: 'BLUE' },
      getCalendarsByName: function () { return [state.calendar || (state.calendar = makeCalendar(state))]; },
      createCalendar: function () { return state.calendar || (state.calendar = makeCalendar(state)); }
    },

    UrlFetchApp: {
      fetch: function () { throw new Error('테스트에서는 외부 호출을 하지 않습니다.'); }
    },

    HtmlService: {
      createTemplateFromFile: function () { return { evaluate: function () { return {}; } }; },
      createHtmlOutputFromFile: function () { return { getContent: function () { return ''; } }; }
    }
  };

  g.globalThis = g;
  state.globals = g;
  return state;
}

function makeCalendar(state) {
  return {
    createEvent: function (title, start, end, opts) {
      const ev = {
        id: 'evt-' + (state.calendarEvents.length + 1),
        title: title, start: start, end: end, description: (opts || {}).description || '',
        getId: function () { return ev.id; },
        getTitle: function () { return ev.title; },
        getStartTime: function () { return ev.start; },
        getEndTime: function () { return ev.end; },
        getDescription: function () { return ev.description; },
        setTitle: function (t) { ev.title = t; },
        setTime: function (s, e) { ev.start = s; ev.end = e; },
        setDescription: function (d) { ev.description = d; },
        deleteEvent: function () { state.calendarEvents = state.calendarEvents.filter(function (x) { return x !== ev; }); }
      };
      state.calendarEvents.push(ev);
      return ev;
    },
    getEventById: function (id) {
      return state.calendarEvents.filter(function (e) { return e.id === id; })[0] || null;
    }
  };
}

module.exports = { buildGlobals, formatDate, parseDate, instantFromWall, wallParts };
