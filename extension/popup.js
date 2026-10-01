import {readPublicSearch} from './reader.js';

const $ = id => document.getElementById(id);
let report = null;
const errors = {
  wrong_page: '코레일의 열차 조회 결과 탭에서 실행해 주세요.',
  missing_list: '조회 목록 영역을 찾지 못했습니다. 목록이 표시된 뒤 다시 눌러 주세요.',
  missing_conditions: '날짜·출발역·도착역을 읽지 못했습니다. 조회 화면인지 확인해 주세요.'
};
$('read').addEventListener('click', async () => {
  report = null;
  $('result').hidden = true;
  $('read').disabled = true;
  $('status').textContent = '현재 탭의 공개 목록을 읽고 있습니다…';
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id) throw new Error('no_tab');
    const result = await chrome.scripting.executeScript({
      target: {tabId: tab.id}, world: 'ISOLATED', func: readPublicSearch
    });
    const data = result[0]?.result;
    if (!data?.ok) {
      $('status').textContent = errors[data?.code] || '목록을 읽지 못했습니다.';
      return;
    }
    report = data;
    $('route').textContent = `${data.conditions.departure} → ${data.conditions.arrival}`;
    $('date').textContent = `${data.conditions.date} · ${data.conditions.passengers}`;
    $('rows').replaceChildren();
    for (const row of data.rows) {
      const li = document.createElement('li');
      li.textContent = row;
      $('rows').append(li);
    }
    const descriptions = {
      readable: `목록을 읽었습니다. 시각이 포함된 항목 ${data.rows.length}개`,
      empty: '사이트가 빈 목록을 표시하고 있습니다. 매진 여부는 판단할 수 없습니다.',
      unrecognized: '목록 영역을 읽었지만 열차 행을 구분하지 못했습니다. 진단 파일을 저장해 주세요.'
    };
    $('status').textContent = descriptions[data.status] + (data.truncated ? '\n내용이 길어 일부만 읽었습니다.' : '');
    $('preview').textContent = JSON.stringify(data, null, 2);
    $('result').hidden = false;
  } catch {
    $('status').textContent = '현재 탭을 읽을 수 없습니다. 코레일 조회 결과 탭에서 다시 실행해 주세요. 시크릿 창은 확장프로그램의 시크릿 모드 허용이 필요합니다.';
  } finally {
    $('read').disabled = false;
  }
});
$('save').addEventListener('click', () => {
  if (!report) return;
  const blob = new Blob([JSON.stringify(report, null, 2)], {type: 'application/json;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `korail-public-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
