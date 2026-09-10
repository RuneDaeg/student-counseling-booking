/**
 * Notion 데이터베이스로 상담 일정 내보내기
 *
 * Notion 페이지 안의 '캘린더 보기' 는 데이터베이스의 행만 보여 줍니다.
 * 구글 캘린더 일정은 그리로 들어가지 않으므로, 여기서 직접 행을 만듭니다.
 *
 * 개인정보: 제목에는 이름만 넣습니다.
 * 학생이 쓴 고민과 AI 분석 결과는 Notion 으로 내보내지 않습니다.
 *
 * powered by 여광재 (온양고등학교)
 * https://github.com/RuneDaeg/student-counseling-booking
 *
 * Copyright 2026 여광재 (온양고등학교)
 * SPDX-License-Identifier: Apache-2.0
 */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const PROP_NOTION_TOKEN = 'NOTION_TOKEN';
const NOTION_PAGE_COL = '노션 페이지ID';
const NOTION_SYNC_LIMIT_MS = 3 * 60 * 1000;

/** 메뉴: 토큰 등록 */
function promptNotionToken() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const current = props.getProperty(PROP_NOTION_TOKEN);

  const res = ui.prompt(
    'Notion 토큰 등록',
    'notion.so/my-integrations 에서 통합(Integration)을 만들고\n' +
    '내부 통합 시크릿(ntn_... 또는 secret_...)을 붙여 넣어 주세요.\n\n' +
    (current ? '현재 등록됨: ' + current.slice(0, 6) + '…' + current.slice(-4) + '\n\n' : '') +
    '그 다음 Notion 에서 쓸 데이터베이스를 열고\n' +
    '[...] → 연결 → 만든 통합을 추가해야 합니다.\n' +
    '(지우려면 - 한 글자만 넣고 확인)',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;

  const value = res.getResponseText().trim();
  if (value === '-') {
    props.deleteProperty(PROP_NOTION_TOKEN);
    ui.alert('토큰을 지웠습니다.');
    return;
  }
  if (!value) {
    ui.alert('입력된 값이 없어 그대로 두었습니다.');
    return;
  }
  props.setProperty(PROP_NOTION_TOKEN, value);
  ui.alert('저장했습니다.\n\n설정 시트의 [노션 데이터베이스 ID] 도 채운 뒤\n[노션에 일정 내보내기] 를 눌러 주세요.');
}

/** 메뉴: 지금 내보내기 */
function syncNotionNow() {
  const ui = SpreadsheetApp.getUi();
  const cfg = getConfig();

  if (!cfg.notionSync) {
    ui.alert('설정 시트의 [노션 연동] 을 TRUE 로 바꾼 뒤 다시 눌러 주세요.');
    return;
  }
  try {
    const result = syncNotion_(cfg);
    ui.alert(
      'Notion 에 맞췄습니다.\n\n' +
      '새로 넣음: ' + result.created + '건\n' +
      '고침: ' + result.updated + '건\n' +
      '지움: ' + result.removed + '건\n\n' +
      'Notion 페이지의 캘린더 보기에서 확인해 보세요.'
    );
  } catch (e) {
    ui.alert('Notion 에 맞추지 못했습니다.\n\n' + e.message);
  }
}

/** 트리거에서 조용히 부를 때 */
function syncNotionQuietly_() {
  try {
    const cfg = getConfig();
    if (cfg.notionSync) syncNotion_(cfg);
  } catch (e) {
    console.error('Notion 연동 실패: ' + e.message);
  }
}

/** 앞으로 남은 예약을 Notion 데이터베이스와 맞춥니다. */
function syncNotion_(cfg) {
  const token = (PropertiesService.getScriptProperties().getProperty(PROP_NOTION_TOKEN) || '').trim();
  if (!token) throw new Error('Notion 토큰이 없습니다. 메뉴 [노션 토큰 등록] 에서 넣어 주세요.');

  const dbId = normalizeNotionId_(cfg.notionDatabaseId);
  if (!dbId) throw new Error('설정 시트의 [노션 데이터베이스 ID] 를 채워 주세요.');

  const schema = notionSchema_(token, dbId);
  const sheet = getSheet_(SHEET_BOOKING);
  const table = readTable_(sheet);
  const idCol = table.index[NOTION_PAGE_COL];
  if (idCol === undefined) {
    throw new Error('"' + NOTION_PAGE_COL + '" 칸이 없습니다. [① 최초 설정 실행] 을 한 번 눌러 주세요.');
  }

  const today = todayKey_(cfg.tz);
  const started = Date.now();
  const result = { created: 0, updated: 0, removed: 0 };

  for (let i = 0; i < table.rows.length; i++) {
    if (Date.now() - started > NOTION_SYNC_LIMIT_MS) break;

    const row = table.rows[i];
    const rowNo = i + 2;
    const dateKey = toDateKey_(row[table.index['상담일']], cfg.tz);
    if (!dateKey || dateKey < today) continue; // 지난 일정은 그대로 둡니다

    const status = String(row[table.index['상태']]).trim();
    const pageId = String(row[idCol] || '').trim();

    if (status === STATUS_CANCELED) {
      if (pageId) {
        notionRequest_(token, 'patch', '/pages/' + pageId, { archived: true });
        sheet.getRange(rowNo, idCol + 1).clearContent();
        result.removed++;
      }
      continue;
    }

    const booking = bookingFromRow_(cfg, rowToObjectWith_(row, table.index));
    const properties = buildNotionProperties_(cfg, schema, booking, dateKey);

    if (pageId) {
      notionRequest_(token, 'patch', '/pages/' + pageId, { properties: properties, archived: false });
      result.updated++;
    } else {
      const page = notionRequest_(token, 'post', '/pages', {
        parent: { database_id: dbId },
        properties: properties
      });
      sheet.getRange(rowNo, idCol + 1).setValue(page.id);
      result.created++;
    }
  }
  return result;
}

/** 데이터베이스의 속성 구성을 읽어 어디에 무엇을 넣을지 정합니다. */
function notionSchema_(token, dbId) {
  const db = notionRequest_(token, 'get', '/databases/' + dbId, null);
  const props = db.properties || {};

  let titleProp = '';
  let dateProp = '';
  const textProps = {};

  Object.keys(props).forEach(function (name) {
    const type = props[name].type;
    if (type === 'title' && !titleProp) titleProp = name;
    else if (type === 'date' && !dateProp) dateProp = name;
    else if (type === 'rich_text' || type === 'select') textProps[name] = type;
  });

  if (!titleProp) throw new Error('데이터베이스에서 제목 속성을 찾지 못했습니다.');
  if (!dateProp) {
    throw new Error(
      '데이터베이스에 날짜(Date) 속성이 없습니다.\n' +
      'Notion 에서 날짜 속성을 하나 만들어야 캘린더 보기에 표시됩니다.'
    );
  }
  return { title: titleProp, date: dateProp, text: textProps };
}

/** 보낼 속성 값을 만듭니다. 이름이 맞는 속성이 있을 때만 채웁니다. */
function buildNotionProperties_(cfg, schema, booking, dateKey) {
  const out = {};
  out[schema.title] = { title: [{ text: { content: '상담 · ' + booking.name } }] };
  out[schema.date] = {
    date: {
      start: notionDateTime_(dateKey, booking.start, cfg.tz),
      end: notionDateTime_(dateKey, booking.end, cfg.tz),
      time_zone: null
    }
  };

  const who = booking.grade + '학년 ' + booking.classNo + '반 ' + booking.studentNo + '번 ' + booking.name;
  const candidates = [
    { keys: ['학생', '학번', '이름'], value: who },
    { keys: ['주제', '유형', '분류'], value: booking.topic },
    { keys: ['예약번호', '번호'], value: booking.id }
  ];

  Object.keys(schema.text).forEach(function (name) {
    for (let i = 0; i < candidates.length; i++) {
      const hit = candidates[i].keys.some(function (k) { return name.indexOf(k) >= 0; });
      if (!hit || !candidates[i].value) continue;
      out[name] = schema.text[name] === 'select'
        ? { select: { name: String(candidates[i].value) } }
        : { rich_text: [{ text: { content: String(candidates[i].value) } }] };
      return;
    }
  });

  return out;
}

/** '2026-09-15' + '13:10' → '2026-09-15T13:10:00+09:00' */
function notionDateTime_(dateKey, time, tz) {
  const d = Utilities.parseDate(dateKey + ' ' + time, tz, 'yyyy-MM-dd HH:mm');
  return Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** 주소를 통째로 넣어도 ID만 골라냅니다. 하이픈 유무 모두 허용. */
function normalizeNotionId_(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.replace(/-/g, '').match(/[0-9a-fA-F]{32}/);
  return m ? m[0] : '';
}

/** Notion API 호출 */
function notionRequest_(token, method, endpoint, body) {
  const options = {
    method: method,
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      'Notion-Version': NOTION_VERSION
    },
    muteHttpExceptions: true
  };
  if (body) options.payload = JSON.stringify(body);

  const res = UrlFetchApp.fetch(NOTION_API + endpoint, options);
  const code = res.getResponseCode();
  const raw = res.getContentText();

  if (code === 200) return JSON.parse(raw);
  throw new Error(explainNotionError_(code, raw));
}

function explainNotionError_(code, raw) {
  let message = '';
  try {
    message = (JSON.parse(raw) || {}).message || '';
  } catch (e) {
    message = String(raw).slice(0, 300);
  }

  if (code === 401) {
    return 'Notion 토큰이 올바르지 않습니다. [노션 토큰 등록] 에서 다시 넣어 주세요.\n원문: ' + message;
  }
  if (code === 404) {
    return '데이터베이스를 찾을 수 없습니다.\n' +
      'ID 가 맞는지, 그리고 Notion 에서 그 데이터베이스에 통합을 연결했는지 확인해 주세요.\n' +
      '(데이터베이스 우측 상단 [...] → 연결 → 만든 통합 추가)\n원문: ' + message;
  }
  if (code === 400) {
    return '보낸 내용을 Notion 이 받지 않았습니다. 속성 구성을 확인해 주세요.\n원문: ' + message;
  }
  return 'Notion 호출 실패 (' + code + '): ' + message;
}
