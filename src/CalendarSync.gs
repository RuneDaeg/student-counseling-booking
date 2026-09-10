/**
 * 구글 캘린더로 상담 일정 내보내기
 *
 * 설정 시트의 [구글 캘린더 연동] 이 TRUE 일 때만 동작합니다.
 * Notion Calendar 는 구글 계정을 그대로 읽으므로, 여기에 넣으면 거기서도 보입니다.
 *
 * 개인정보: 일정 제목에는 이름만 넣습니다.
 * 학생이 쓴 고민과 AI 분석 결과는 캘린더에 내보내지 않습니다.
 *
 * powered by 여광재 (온양고등학교)
 * https://github.com/RuneDaeg/student-counseling-booking
 *
 * Copyright 2026 여광재 (온양고등학교)
 * SPDX-License-Identifier: Apache-2.0
 */

const CAL_EVENT_COL = '캘린더 일정ID';
const CAL_SYNC_LIMIT_MS = 3 * 60 * 1000;

/** 메뉴에서 부르는 함수 */
function syncCalendarNow() {
  const ui = SpreadsheetApp.getUi();
  const cfg = getConfig();

  if (!cfg.calendarSync) {
    ui.alert('설정 시트의 [구글 캘린더 연동] 을 TRUE 로 바꾼 뒤 다시 눌러 주세요.');
    return;
  }
  try {
    const result = syncCalendar_(cfg);
    ui.alert(
      '구글 캘린더에 맞췄습니다.\n\n' +
      '캘린더: ' + cfg.calendarName + '\n' +
      '새로 넣음: ' + result.created + '건\n' +
      '고침: ' + result.updated + '건\n' +
      '지움: ' + result.removed + '건\n\n' +
      'Notion Calendar 에서 이 구글 계정을 연결하면 그쪽에서도 보입니다.'
    );
  } catch (e) {
    ui.alert('캘린더에 맞추지 못했습니다.\n\n' + e.message);
  }
}

/** 트리거에서 조용히 부를 때 */
function syncCalendarQuietly_() {
  try {
    const cfg = getConfig();
    if (cfg.calendarSync) syncCalendar_(cfg);
  } catch (e) {
    console.error('캘린더 연동 실패: ' + e.message);
  }
}

/**
 * 앞으로 남은 예약을 캘린더와 맞춥니다.
 * 지난 일정은 건드리지 않습니다.
 */
function syncCalendar_(cfg) {
  const sheet = getSheet_(SHEET_BOOKING);
  const table = readTable_(sheet);
  const idCol = table.index[CAL_EVENT_COL];
  if (idCol === undefined) {
    throw new Error('"' + CAL_EVENT_COL + '" 칸이 없습니다. [① 최초 설정 실행] 을 한 번 눌러 주세요.');
  }

  const cal = getCounselCalendar_(cfg);
  const today = todayKey_(cfg.tz);
  const started = Date.now();
  const result = { created: 0, updated: 0, removed: 0 };

  for (let i = 0; i < table.rows.length; i++) {
    if (Date.now() - started > CAL_SYNC_LIMIT_MS) break;

    const row = table.rows[i];
    const rowNo = i + 2;
    const dateKey = toDateKey_(row[table.index['상담일']], cfg.tz);
    if (!dateKey || dateKey < today) continue; // 지난 일정은 그대로 둡니다

    const status = String(row[table.index['상태']]).trim();
    const eventId = String(row[idCol] || '').trim();

    if (status === STATUS_CANCELED) {
      if (eventId && deleteEvent_(cal, eventId)) {
        sheet.getRange(rowNo, idCol + 1).clearContent();
        result.removed++;
      }
      continue;
    }

    const booking = bookingFromRow_(cfg, rowToObjectWith_(row, table.index));
    const title = '상담 · ' + booking.name;
    const start = Utilities.parseDate(dateKey + ' ' + booking.start, cfg.tz, 'yyyy-MM-dd HH:mm');
    const end = Utilities.parseDate(dateKey + ' ' + booking.end, cfg.tz, 'yyyy-MM-dd HH:mm');
    const description = buildEventDescription_(booking);

    let event = eventId ? tryGetEvent_(cal, eventId) : null;

    if (event) {
      let changed = false;
      if (event.getTitle() !== title) { event.setTitle(title); changed = true; }
      if (event.getStartTime().getTime() !== start.getTime() ||
        event.getEndTime().getTime() !== end.getTime()) {
        event.setTime(start, end);
        changed = true;
      }
      if (event.getDescription() !== description) { event.setDescription(description); changed = true; }
      if (changed) result.updated++;
    } else {
      event = cal.createEvent(title, start, end, { description: description });
      sheet.getRange(rowNo, idCol + 1).setValue(event.getId());
      result.created++;
    }
  }
  return result;
}

/** 일정 설명. 고민 내용과 AI 분석은 넣지 않습니다. */
function buildEventDescription_(booking) {
  return [
    booking.grade + '학년 ' + booking.classNo + '반 ' + booking.studentNo + '번 ' + booking.name,
    booking.topic ? '상담 주제: ' + booking.topic : '',
    '예약번호: ' + booking.id,
    '',
    '상담 내용과 AI 초안은 스프레드시트에서 확인해 주세요.'
  ].filter(function (s) { return s !== ''; }).join('\n');
}

/** 설정한 이름의 캘린더를 찾고, 없으면 새로 만듭니다. */
function getCounselCalendar_(cfg) {
  const found = CalendarApp.getCalendarsByName(cfg.calendarName);
  if (found && found.length) return found[0];

  return CalendarApp.createCalendar(cfg.calendarName, {
    summary: '학생 상담 신청 웹앱이 자동으로 관리하는 캘린더입니다. 직접 고치면 다음 동기화 때 되돌아갑니다.',
    color: CalendarApp.Color.BLUE
  });
}

/** 지워졌거나 찾을 수 없는 일정이면 null */
function tryGetEvent_(cal, eventId) {
  try {
    return cal.getEventById(eventId);
  } catch (e) {
    return null;
  }
}

function deleteEvent_(cal, eventId) {
  const event = tryGetEvent_(cal, eventId);
  if (!event) return true; // 이미 없으면 지운 것으로 봅니다
  try {
    event.deleteEvent();
    return true;
  } catch (e) {
    console.error('일정 삭제 실패: ' + e.message);
    return false;
  }
}

/** 이미 읽어 둔 행을 헤더 이름으로 다루기 (시트를 다시 읽지 않습니다) */
function rowToObjectWith_(row, index) {
  const obj = {};
  Object.keys(index).forEach(function (h) { obj[h] = row[index[h]]; });
  return obj;
}
