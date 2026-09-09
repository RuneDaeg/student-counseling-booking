/**
 * 최초 설정 · 스프레드시트 메뉴
 *
 * powered by 여광재 (온양고등학교)
 * https://github.com/RuneDaeg/student-counseling-booking
 *
 * Copyright 2026 여광재 (온양고등학교)
 * SPDX-License-Identifier: Apache-2.0
 */

const BOOKING_HEADERS = [
  '예약번호', '신청시각', '상담일', '시작시각', '종료시각',
  '학년', '반', '번호', '이름',
  '상담유형', '고민내용', 'AI분석동의', '상태',
  'AI 요약', 'AI 상담 초안', 'AI 관심신호', 'AI 분석시각', '교사 메모'
];

const BLOCK_HEADERS = ['시작일', '종료일', '시작시각', '종료시각', '사유'];
const CONFIG_HEADERS = ['항목', '값', '설명'];

/** 예전 버전에서 쓰던 설정 항목. 최초 설정을 다시 실행하면 지웁니다. */
const OBSOLETE_CONFIG_KEYS = ['상담 시작 시각', '상담 종료 시각', '상담 사이 쉬는 시간(분)', '연락처 필수'];

/** 이름만 바뀐 설정 항목. 적어 두신 값은 그대로 옮겨 옵니다. */
const CONFIG_RENAMES = {
  '예약 시작(오늘부터 며칠 뒤)': '예약 시작',
  '예약 종료(오늘부터 며칠 뒤)': '예약 종료'
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('상담 관리')
    .addItem('① 최초 설정 실행', 'setupSpreadsheet')
    .addItem('② AI 키 등록 / 변경', 'promptApiKey')
    .addItem('②-1 AI 워크스페이스 ID 등록 (필요할 때만)', 'promptWorkspaceId')
    .addItem('③ AI 연결 테스트', 'testAiConnection')
    .addSeparator()
    .addItem('선택한 예약 AI 다시 분석', 'reanalyzeSelectedRows')
    .addItem('오늘 상담 브리핑 메일 받기', 'sendTodayBriefing')
    .addSeparator()
    .addItem('웹앱 주소 보기', 'showWebAppUrl')
    .addToUi();
}

/** 시트 3개를 만들고 서식·기본값을 채웁니다. 여러 번 눌러도 안전합니다. */
function setupSpreadsheet() {
  const ss = getSpreadsheet_();
  const tz = getTimeZone_();

  // 1) 설정 시트
  const cfg = ensureSheet_(ss, SHEET_CONFIG, CONFIG_HEADERS);
  const existing = {};
  if (cfg.getLastRow() > 1) {
    cfg.getRange(2, 1, cfg.getLastRow() - 1, 1).getValues().forEach(function (r, i) {
      existing[String(r[0]).trim()] = i + 2;
    });
  }
  // 이름이 바뀐 항목은 값을 지키기 위해 제자리에서 이름만 고칩니다.
  Object.keys(CONFIG_RENAMES).forEach(function (oldKey) {
    const newKey = CONFIG_RENAMES[oldKey];
    if (!existing[oldKey]) return;
    if (existing[newKey]) return; // 새 이름이 이미 있으면 옛 줄은 아래에서 지웁니다
    cfg.getRange(existing[oldKey], 1).setValue(newKey);
    existing[newKey] = existing[oldKey];
    delete existing[oldKey];
  });

  CONFIG_DEFAULTS.forEach(function (def) {
    if (existing[def[0]]) {
      cfg.getRange(existing[def[0]], 3).setValue(def[2]); // 설명만 갱신
    } else {
      cfg.appendRow([def[0], def[1], def[2]]);
    }
  });
  // 더 이상 쓰지 않는 항목은 아래에서 위로 지웁니다 (행 번호가 밀리지 않도록)
  OBSOLETE_CONFIG_KEYS.concat(Object.keys(CONFIG_RENAMES))
    .map(function (k) { return existing[k]; })
    .filter(function (r) { return !!r; })
    .sort(function (a, b) { return b - a; })
    .forEach(function (r) { cfg.deleteRow(r); });
  cfg.setColumnWidth(1, 200).setColumnWidth(2, 260).setColumnWidth(3, 420);
  cfg.getRange(2, 2, Math.max(1, cfg.getLastRow() - 1), 1).setNumberFormat('@'); // 값은 텍스트로

  // 2) 상담불가 시트
  const block = ensureSheet_(ss, SHEET_BLOCK, BLOCK_HEADERS);
  if (block.getLastRow() === 1) {
    const sample = addDaysKey_(todayKey_(tz), 3);
    block.appendRow([sample, '', '', '', '(예시) 출장 - 이 줄은 지우고 쓰세요']);
    block.appendRow([addDaysKey_(todayKey_(tz), 5), '', '16:00', '17:30', '(예시) 회의 - 이 시간대만 막힘']);
  }
  block.getRange(2, 1, block.getMaxRows() - 1, 2).setNumberFormat('yyyy-mm-dd');
  block.getRange(2, 3, block.getMaxRows() - 1, 2).setNumberFormat('@');
  block.setColumnWidth(1, 110).setColumnWidth(2, 110).setColumnWidth(3, 90).setColumnWidth(4, 90).setColumnWidth(5, 340);
  block.getRange('A1:E1').setNote(
    '시작일만 쓰면 그 날 하루 전체가 막힙니다.\n' +
    '종료일까지 쓰면 그 기간 전체가 막힙니다.\n' +
    '시작시각·종료시각을 쓰면 그 시간대만 막힙니다.'
  );

  // 3) 예약 시트
  const booking = ensureSheet_(ss, SHEET_BOOKING, BOOKING_HEADERS);
  booking.setFrozenColumns(1);
  const bIdx = readTable_(booking).index;
  const rows = booking.getMaxRows() - 1;
  booking.getRange(2, bIdx['상담일'] + 1, rows, 1).setNumberFormat('yyyy-mm-dd');
  booking.getRange(2, bIdx['신청시각'] + 1, rows, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  booking.getRange(2, bIdx['AI 분석시각'] + 1, rows, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  // 시각·번호는 텍스트로 두어야 '15:30' 이 시간값으로 바뀌며 생기는 오차가 없습니다.
  ['예약번호', '시작시각', '종료시각'].forEach(function (h) {
    booking.getRange(2, bIdx[h] + 1, rows, 1).setNumberFormat('@');
  });
  [['고민내용', 320], ['AI 요약', 320], ['AI 상담 초안', 460], ['AI 관심신호', 200], ['교사 메모', 240]].forEach(function (c) {
    booking.setColumnWidth(bIdx[c[0]] + 1, c[1]);
  });
  booking.getRange(2, bIdx['상태'] + 1, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList([STATUS_ACTIVE, STATUS_CANCELED, STATUS_DONE], true).build()
  );
  applyRiskFormatting_(booking, bIdx);

  // 4) 예약 마감/재분석용 정기 트리거
  ensureRecurringTrigger_();

  SpreadsheetApp.getActive().toast('시트 준비가 끝났습니다. 이어서 [② AI 키 등록]을 눌러 주세요.', '상담 관리', 8);
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const oldCols = sheet.getLastColumn();
  const current = sheet.getRange(1, 1, 1, Math.max(headers.length, oldCols || 1)).getValues()[0];
  const same = headers.every(function (h, i) { return String(current[i]).trim() === h; });
  if (!same) {
    // 자료가 이미 들어 있는데 항목 구성이 다르면, 열이 밀려 값이 섞이므로 손대지 않습니다.
    if (sheet.getLastRow() > 1) {
      throw new Error(
        '"' + name + '" 시트의 항목 구성이 지금 코드와 다릅니다.\n' +
        '이미 들어 있는 자료가 밀릴 수 있어 자동으로 고치지 않았습니다.\n' +
        '기존 자료를 다른 시트에 복사해 두고 2행 아래를 모두 지운 뒤 다시 실행해 주세요.'
      );
    }
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (oldCols > headers.length) {
      sheet.getRange(1, headers.length + 1, 1, oldCols - headers.length).clearContent();
    }
  }
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#e8eef7')
    .setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  return sheet;
}

/** 관심신호가 '높음'·'보통'인 줄에 색을 입힙니다. 여러 번 실행해도 규칙이 쌓이지 않습니다. */
function applyRiskFormatting_(sheet, idx) {
  const col = columnLetter_(idx['AI 관심신호'] + 1);
  const range = sheet.getRange(2, 1, sheet.getMaxRows() - 1, sheet.getLastColumn());
  const mine = {
    '높음': '=REGEXMATCH(TO_TEXT($' + col + '2),"높음")',
    '보통': '=REGEXMATCH(TO_TEXT($' + col + '2),"보통")'
  };
  const formulas = Object.keys(mine).map(function (k) { return mine[k]; });

  const rules = sheet.getConditionalFormatRules().filter(function (r) {
    const cond = r.getBooleanCondition();
    if (!cond) return true;
    const values = cond.getCriteriaValues() || [];
    return formulas.indexOf(String(values[0])) < 0; // 이전에 넣은 같은 규칙만 걷어냅니다
  });

  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(mine['높음']).setBackground('#fce8e6').setRanges([range]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(mine['보통']).setBackground('#fff7e0').setRanges([range]).build());
  sheet.setConditionalFormatRules(rules);
}

function columnLetter_(col) {
  let s = '';
  while (col > 0) {
    const m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = Math.floor((col - m) / 26);
  }
  return s;
}

/** 놓친 분석을 10분마다 다시 시도하는 안전망 트리거 */
function ensureRecurringTrigger_() {
  const has = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'runPendingAnalysisScheduled';
  });
  if (!has) {
    ScriptApp.newTrigger('runPendingAnalysisScheduled').timeBased().everyMinutes(10).create();
  }
}

function promptApiKey() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const current = props.getProperty(PROP_API_KEY) || props.getProperty('ANTHROPIC_API_KEY');
  const provider = getProvider_(getConfig());
  const info = AI_PROVIDERS[provider];

  const res = ui.prompt(
    'AI 키 등록',
    '지금 설정된 제공자: ' + info.label + '\n' +
    '필요한 키: ' + info.keyHint + '\n\n' +
    '키를 붙여 넣어 주세요.' +
    (current ? '\n\n현재 등록된 키: ' + current.slice(0, 6) + '…' + current.slice(-4) : '') +
    '\n\n다른 회사 AI를 쓰려면 설정 시트의 [AI 제공자] 를 먼저 바꾼 뒤 이 메뉴로 돌아오세요.\n' +
    '키는 스크립트 속성에 저장되며 스프레드시트에는 남지 않습니다.',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = res.getResponseText().trim();
  if (!key) {
    ui.alert('입력된 키가 없어 그대로 두었습니다.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty(PROP_API_KEY, key);
  ui.alert('저장했습니다. [③ AI 연결 테스트]로 확인해 보세요.');
}

/**
 * 워크스페이스에 묶이지 않은 조직 단위 키를 쓸 때만 필요합니다.
 * "This API key is not scoped to a workspace" 오류가 났다면 여기에 ID를 넣으세요.
 */
function promptWorkspaceId() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const current = props.getProperty(PROP_WORKSPACE_ID) || '';
  const res = ui.prompt(
    'AI 워크스페이스 ID',
    'Anthropic 콘솔 > Settings > Workspaces 에서 워크스페이스를 연 뒤\n' +
    '주소창의 wrkspc_ 로 시작하는 ID를 붙여 넣어 주세요.\n\n' +
    (current ? '현재 값: ' + current + '\n\n' : '') +
    '워크스페이스가 지정된 키를 새로 발급했다면 이 값은 필요 없습니다.\n' +
    '(지우려면 - 한 글자만 넣고 확인)',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;

  const value = res.getResponseText().trim();
  if (value === '-') {
    props.deleteProperty(PROP_WORKSPACE_ID);
    ui.alert('워크스페이스 ID를 지웠습니다.');
    return;
  }
  if (!value) {
    ui.alert('입력된 값이 없어 그대로 두었습니다.');
    return;
  }
  props.setProperty(PROP_WORKSPACE_ID, value);
  ui.alert('저장했습니다. [③ AI 연결 테스트]로 확인해 보세요.');
}

function testAiConnection() {
  const ui = SpreadsheetApp.getUi();
  const cfg = getConfig();
  const provider = getProvider_(cfg);
  try {
    const text = callAi_(
      cfg,
      '당신은 연결 확인용 도우미입니다. 한 문장으로만 답하세요.',
      '연결 확인. "정상"이라고만 답해 주세요.',
      null,
      4000
    );
    ui.alert(
      'AI 연결 성공\n\n' +
      '제공자: ' + AI_PROVIDERS[provider].label + '\n' +
      '모델: ' + resolveModel_(cfg, provider) + '\n' +
      '응답: ' + text.slice(0, 200)
    );
  } catch (e) {
    ui.alert('AI 연결 실패\n\n제공자: ' + AI_PROVIDERS[provider].label + '\n\n' + e.message);
  }
}

function showWebAppUrl() {
  const url = ScriptApp.getService().getUrl();
  const ui = SpreadsheetApp.getUi();
  if (!url) {
    ui.alert('아직 배포되지 않았습니다.\n\n[배포 > 새 배포 > 웹 앱]에서\n· 실행 계정: 나\n· 액세스 권한: 모든 사용자\n로 배포한 뒤 다시 눌러 주세요.');
    return;
  }
  ui.alert('학생에게 이 주소를 알려 주세요.\n\n' + url);
}

/** 선택한 줄의 예약을 다시 분석합니다. */
function reanalyzeSelectedRows() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== SHEET_BOOKING) {
    ui.alert('"' + SHEET_BOOKING + '" 시트에서 다시 분석할 줄을 선택한 뒤 눌러 주세요.');
    return;
  }
  const table = readTable_(sheet);
  const sel = sheet.getActiveRangeList().getRanges();
  const rowNumbers = [];
  sel.forEach(function (range) {
    for (let r = range.getRow(); r < range.getRow() + range.getNumRows(); r++) {
      if (r > 1 && rowNumbers.indexOf(r) < 0) rowNumbers.push(r);
    }
  });
  if (!rowNumbers.length) {
    ui.alert('분석할 줄을 먼저 선택해 주세요.');
    return;
  }
  // 분석시각을 지워 대기 상태로 되돌립니다.
  rowNumbers.forEach(function (r) {
    sheet.getRange(r, table.index['AI 분석시각'] + 1).clearContent();
  });
  SpreadsheetApp.getActive().toast(rowNumbers.length + '건을 분석합니다. 잠시 기다려 주세요.', '상담 관리', 5);
  const done = runPendingAnalysis(true);
  ui.alert('분석을 마쳤습니다. (' + done + '건)');
}
