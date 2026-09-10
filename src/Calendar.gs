/**
 * 상담 달력 시트 그리기
 *
 * '예약' 시트의 내용을 달력 모양으로 다시 그립니다.
 * 사람이 손으로 고치는 시트가 아니라, 누를 때마다 새로 그려지는 화면입니다.
 *
 * powered by 여광재 (온양고등학교)
 * https://github.com/RuneDaeg/student-counseling-booking
 *
 * Copyright 2026 여광재 (온양고등학교)
 * SPDX-License-Identifier: Apache-2.0
 */

const CAL_MONTHS = 2;      // 한 번에 그릴 개월 수
const CAL_COLS = 7;        // 월~일
const CAL_ROW_HEIGHT = 78;
const CAL_COL_WIDTH = 132;

const CAL_COLOR = {
  header: '#3b6fd4',
  dowBg: '#eef2f9',
  today: '#fff4cc',
  booked: '#eaf0fd',
  blocked: '#f1f2f4',
  risk: '#fce8e6',
  empty: '#ffffff',
  line: '#d8dce4'
};

/** 메뉴에서 부르는 함수 */
function refreshCalendar() {
  const cfg = getConfig();
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_CALENDAR);
  if (!sheet) sheet = ss.insertSheet(SHEET_CALENDAR);

  const startMonth = readCalendarMonth_(sheet, cfg.tz);
  const byDate = readBookingsByDate_(cfg);
  const blocks = readBlocks_(cfg.tz);
  const today = todayKey_(cfg.tz);

  sheet.getRange(1, 1, sheet.getMaxRows(), Math.max(CAL_COLS, sheet.getMaxColumns())).breakApart();
  sheet.clear();

  // 조작 줄
  sheet.getRange('A1').setValue('기준 월').setFontWeight('bold');
  sheet.getRange('B1').setValue(startMonth).setNumberFormat('@');
  sheet.getRange('C1')
    .setValue('← 여기를 바꾸고 [상담 관리 > 상담 달력 새로 그리기] 를 누르세요. 비우면 이번 달부터 그립니다.')
    .setFontColor('#6b7482');
  sheet.getRange('C1:G1').merge().setHorizontalAlignment('left');

  let row = 3;
  for (let i = 0; i < CAL_MONTHS; i++) {
    row = drawMonth_(sheet, row, addMonths_(startMonth, i), byDate, blocks, today, cfg);
    row += 1;
  }

  for (let c = 1; c <= CAL_COLS; c++) sheet.setColumnWidth(c, CAL_COL_WIDTH);
  sheet.setFrozenRows(2);
  sheet.setHiddenGridlines(true);
  SpreadsheetApp.flush();
  return sheet;
}

/** 트리거·다른 함수에서 조용히 부를 때 (실패해도 본 작업을 막지 않습니다) */
function refreshCalendarQuietly_() {
  try {
    if (getSpreadsheet_().getSheetByName(SHEET_CALENDAR)) refreshCalendar();
  } catch (e) {
    console.error('달력 갱신 실패: ' + e.message);
  }
}

/** 한 달치를 그리고 다음 시작 행을 돌려줍니다. */
function drawMonth_(sheet, startRow, monthKey, byDate, blocks, today, cfg) {
  const parts = monthKey.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const firstKey = monthKey + '-01';
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstDow = dowFromKey_(firstKey); // 1=월
  const weeks = Math.ceil((firstDow - 1 + daysInMonth) / CAL_COLS);

  // 이 달 상담 건수
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = monthKey + '-' + pad2_(d);
    count += (byDate[key] || []).length;
  }

  // 제목 줄
  const titleRange = sheet.getRange(startRow, 1, 1, CAL_COLS);
  titleRange.merge()
    .setValue(year + '년 ' + month + '월    ·    상담 ' + count + '건')
    .setFontSize(13)
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground(CAL_COLOR.header)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(startRow, 28);

  // 요일 줄
  const dowRow = startRow + 1;
  sheet.getRange(dowRow, 1, 1, CAL_COLS)
    .setValues([DOW_NAMES])
    .setFontWeight('bold')
    .setBackground(CAL_COLOR.dowBg)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.getRange(dowRow, 6).setFontColor('#4a7fd0'); // 토
  sheet.getRange(dowRow, 7).setFontColor('#cf6a6a'); // 일
  sheet.setRowHeight(dowRow, 22);

  // 날짜 칸
  const gridRow = dowRow + 1;
  const values = [];
  const backgrounds = [];
  const cells = []; // 나중에 서식을 입힐 정보

  for (let w = 0; w < weeks; w++) {
    const rowValues = [];
    const rowColors = [];
    for (let c = 0; c < CAL_COLS; c++) {
      const dayNum = w * CAL_COLS + c - (firstDow - 1) + 1;
      if (dayNum < 1 || dayNum > daysInMonth) {
        rowValues.push('');
        rowColors.push(CAL_COLOR.empty);
        continue;
      }
      const key = monthKey + '-' + pad2_(dayNum);
      const list = byDate[key] || [];
      const block = blocks.filter(function (b) {
        return key >= b.startKey && key <= b.endKey;
      })[0];

      const lines = [String(dayNum)];
      list.forEach(function (b) {
        lines.push((b.done ? '✓ ' : '') + b.start + ' ' + b.who);
      });
      if (!list.length && block) {
        lines.push(block.allDay ? '(상담 불가)' : '(' + minutesToTime_(block.startMin) + '~ 불가)');
        if (block.reason) lines.push(block.reason);
      }

      rowValues.push(lines.join('\n'));
      rowColors.push(
        list.some(function (b) { return b.risk; }) ? CAL_COLOR.risk
          : key === today ? CAL_COLOR.today
            : list.length ? CAL_COLOR.booked
              : block ? CAL_COLOR.blocked
                : CAL_COLOR.empty
      );
      cells.push({ row: gridRow + w, col: c + 1, dayLen: String(dayNum).length, weekend: c >= 5 });
    }
    values.push(rowValues);
    backgrounds.push(rowColors);
    sheet.setRowHeight(gridRow + w, CAL_ROW_HEIGHT);
  }

  const grid = sheet.getRange(gridRow, 1, weeks, CAL_COLS);
  grid.setValues(values)
    .setBackgrounds(backgrounds)
    .setVerticalAlignment('top')
    .setHorizontalAlignment('left')
    .setWrap(true)
    .setFontSize(10)
    .setBorder(true, true, true, true, true, true, CAL_COLOR.line, SpreadsheetApp.BorderStyle.SOLID);

  // 날짜 숫자만 굵게
  cells.forEach(function (c) {
    const cell = sheet.getRange(c.row, c.col);
    const text = cell.getValue();
    if (!text) return;
    cell.setRichTextValue(
      SpreadsheetApp.newRichTextValue()
        .setText(String(text))
        .setTextStyle(0, c.dayLen, SpreadsheetApp.newTextStyle()
          .setBold(true)
          .setFontSize(11)
          .setForegroundColor(c.weekend ? '#a05050' : '#1c212c')
          .build())
        .build()
    );
  });

  return gridRow + weeks;
}

/** '예약' 시트 → { 'yyyy-MM-dd': [ {start, who, done, risk} ] } */
function readBookingsByDate_(cfg) {
  const sheet = getSpreadsheet_().getSheetByName(SHEET_BOOKING);
  const out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;

  const table = readTable_(sheet);
  table.rows.forEach(function (row) {
    const status = String(row[table.index['상태']]).trim();
    if (status === STATUS_CANCELED) return;

    const dateKey = toDateKey_(row[table.index['상담일']], cfg.tz);
    if (!dateKey) return;

    const name = String(row[table.index['이름']] || '').trim();
    const classNo = String(row[table.index['반']] || '').trim();
    const risk = String(row[table.index['AI 관심신호']] || '').indexOf('높음') === 0;

    if (!out[dateKey]) out[dateKey] = [];
    out[dateKey].push({
      startMin: parseTimeToMinutes_(row[table.index['시작시각']], cfg.tz, 0),
      start: minutesToTime_(parseTimeToMinutes_(row[table.index['시작시각']], cfg.tz, 0)),
      who: cfg.fixedClass ? name : (classNo ? classNo + '반 ' + name : name),
      done: status === STATUS_DONE,
      risk: risk
    });
  });

  Object.keys(out).forEach(function (k) {
    out[k].sort(function (a, b) { return a.startMin - b.startMin; });
  });
  return out;
}

/** B1 의 기준 월을 읽습니다. 비어 있거나 이상하면 이번 달. */
function readCalendarMonth_(sheet, tz) {
  const raw = sheet.getRange('B1').getValue();
  const asDate = toDateKey_(raw, tz);
  if (asDate) return asDate.slice(0, 7);

  const m = String(raw).match(/(\d{4})\s*[-./년]\s*(\d{1,2})/);
  if (m) return m[1] + '-' + pad2_(Number(m[2]));

  return todayKey_(tz).slice(0, 7);
}

/** 'yyyy-MM' 에 개월 수를 더합니다. */
function addMonths_(monthKey, n) {
  const p = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1 + n, 1));
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1);
}
