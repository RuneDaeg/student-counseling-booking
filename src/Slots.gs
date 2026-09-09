/**
 * 예약 가능한 날짜·시간대 계산
 * - '상담불가' 시트에 적힌 날짜/시간은 자동으로 빠집니다.
 * - 이미 찬 시간대, 이미 지난 시간대도 빠집니다.
 *
 * powered by 여광재 (온양고등학교)
 * https://github.com/RuneDaeg/student-counseling-booking
 */

/** 설정을 잘못 적어도 화면이 멈추지 않도록 하루 개수를 제한합니다. */
const MAX_RANGE_DAYS = 366;

/** 웹앱 첫 화면이 부르는 함수 */
function getAvailability() {
  const cfg = getConfig();
  const tz = cfg.tz;
  const blocks = readBlocks_(tz);
  const counts = readSlotCounts_(tz);
  const today = todayKey_(tz);
  const nowMin = nowMinutes_(tz);

  const days = [];
  let key = cfg.firstKey;
  for (let guard = 0; key <= cfg.lastKey && guard < MAX_RANGE_DAYS; guard++, key = addDaysKey_(key, 1)) {
    const dow = dowFromKey_(key);

    if (cfg.weekdays.indexOf(dow) < 0) {
      days.push({ date: key, dow: dow, label: formatDayLabel_(key), status: 'closed', reason: '상담을 받지 않는 요일이에요', slots: [] });
      continue;
    }

    const fullDayBlock = blocks.filter(function (b) {
      return b.allDay && key >= b.startKey && key <= b.endKey;
    })[0];
    if (fullDayBlock) {
      days.push({
        date: key,
        dow: dow,
        label: formatDayLabel_(key),
        status: 'blocked',
        reason: fullDayBlock.reason ? '선생님 일정 · ' + fullDayBlock.reason : '선생님이 상담할 수 없는 날이에요',
        slots: []
      });
      continue;
    }

    // 고를 수 없는 시간도 이유와 함께 내려보냅니다. (화면에서 이유를 보여 주기 위해)
    const slots = [];
    const reasonsSeen = {};
    let openCount = 0;

    slotStartsFor_(cfg, dow).forEach(function (start) {
      const end = start + cfg.slotMinutes;
      const label = minutesToTime_(start);
      const used = counts[key + '|' + label] || 0;
      let reason = '';

      const hit = blocks.filter(function (b) {
        if (b.allDay || key < b.startKey || key > b.endKey) return false;
        return start < b.endMin && end > b.startMin; // 시간대 겹침
      })[0];

      if (key === today && start - cfg.cutoffMinutes < nowMin) {
        reason = start < nowMin
          ? '이미 지난 시간이에요'
          : '신청이 마감됐어요 (상담 시작 ' + cfg.cutoffMinutes + '분 전까지)';
      } else if (hit) {
        reason = hit.reason ? '선생님 일정 · ' + hit.reason : '선생님이 상담할 수 없는 시간이에요';
      } else if (used >= cfg.capacity) {
        reason = '이미 예약이 찼어요';
      }

      if (reason) {
        reasonsSeen[reason] = true;
        slots.push({ start: label, end: minutesToTime_(end), available: false, reason: reason });
      } else {
        openCount++;
        slots.push({ start: label, end: minutesToTime_(end), available: true, left: cfg.capacity - used });
      }
    });

    const reasonList = Object.keys(reasonsSeen);
    days.push({
      date: key,
      dow: dow,
      label: formatDayLabel_(key),
      status: openCount ? 'open' : 'full',
      reason: openCount ? '' : (reasonList.length === 1 ? reasonList[0] : '이 날은 남은 시간이 없어요'),
      slots: slots
    });
  }

  // 고를 날짜가 하나도 없을 때만 이유를 알려 줍니다.
  let windowMessage = '';
  if (!days.length) {
    windowMessage = today > cfg.lastKey
      ? '상담 신청 기간이 끝났습니다. (' + formatDayLabel_(cfg.lastKey) + '까지)'
      : '지금은 신청을 받지 않습니다. 설정의 예약 시작·종료 날짜를 확인해 주세요.';
  }

  return {
    ok: true,
    title: cfg.title,
    notice: cfg.notice,
    windowMessage: windowMessage,
    topics: cfg.topics,
    minChars: cfg.minChars,
    fixedGrade: cfg.fixedGrade,
    fixedClass: cfg.fixedClass,
    aiEnabled: cfg.aiEnabled,
    aiConsentRequired: cfg.aiConsentRequired,
    slotMinutes: cfg.slotMinutes,
    firstDate: days.length ? days[0].date : todayKey_(tz),
    lastDate: days.length ? days[days.length - 1].date : todayKey_(tz),
    days: days
  };
}

/** '상담불가' 시트 → 차단 구간 목록 */
function readBlocks_(tz) {
  const sheet = getSpreadsheet_().getSheetByName(SHEET_BLOCK);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const table = readTable_(sheet);
  const out = [];
  table.rows.forEach(function (row) {
    const startKey = toDateKey_(row[table.index['시작일']], tz);
    if (!startKey) return;
    const endKey = toDateKey_(row[table.index['종료일']], tz) || startKey;
    const rawStart = row[table.index['시작시각']];
    const rawEnd = row[table.index['종료시각']];
    const hasTime = String(rawStart).trim() !== '' || String(rawEnd).trim() !== '';
    out.push({
      startKey: startKey,
      endKey: endKey < startKey ? startKey : endKey,
      allDay: !hasTime,
      startMin: hasTime ? parseTimeToMinutes_(rawStart, tz, 0) : 0,
      endMin: hasTime ? parseTimeToMinutes_(rawEnd, tz, 24 * 60) : 24 * 60,
      reason: String(row[table.index['사유']] || '').trim()
    });
  });
  return out;
}

/** '예약' 시트 → { '2026-09-08|15:30': 인원 } */
function readSlotCounts_(tz) {
  const sheet = getSpreadsheet_().getSheetByName(SHEET_BOOKING);
  const counts = {};
  if (!sheet || sheet.getLastRow() < 2) return counts;
  const table = readTable_(sheet);
  table.rows.forEach(function (row) {
    if (String(row[table.index['상태']]).trim() === STATUS_CANCELED) return;
    const dateKey = toDateKey_(row[table.index['상담일']], tz);
    if (!dateKey) return;
    const start = minutesToTime_(parseTimeToMinutes_(row[table.index['시작시각']], tz, -1));
    const k = dateKey + '|' + start;
    counts[k] = (counts[k] || 0) + 1;
  });
  return counts;
}

/** 신청 직전에 서버에서 한 번 더 확인합니다. */
function isSlotOpen_(cfg, dateKey, startTime) {
  const tz = cfg.tz;
  const today = todayKey_(tz);
  if (dateKey < cfg.firstKey || dateKey > cfg.lastKey) return '신청할 수 있는 기간이 아닙니다.';
  if (cfg.weekdays.indexOf(dowFromKey_(dateKey)) < 0) return '상담을 받지 않는 요일입니다.';

  const startMin = parseTimeToMinutes_(startTime, tz, -1);
  if (startMin < 0) return '시간 형식이 올바르지 않습니다.';
  const endMin = startMin + cfg.slotMinutes;

  if (slotStartsFor_(cfg, dowFromKey_(dateKey)).indexOf(startMin) < 0) return '선택할 수 없는 시간입니다.';
  if (dateKey === today && startMin - cfg.cutoffMinutes < nowMinutes_(tz)) return '신청이 마감된 시간입니다.';

  const blocked = readBlocks_(tz).some(function (b) {
    if (dateKey < b.startKey || dateKey > b.endKey) return false;
    return b.allDay || (startMin < b.endMin && endMin > b.startMin);
  });
  if (blocked) return '선생님이 상담할 수 없는 시간입니다.';

  const used = readSlotCounts_(tz)[dateKey + '|' + minutesToTime_(startMin)] || 0;
  if (used >= cfg.capacity) return '방금 다른 학생이 신청했습니다. 다른 시간을 골라 주세요.';

  return '';
}
