/**
 * 웹앱 진입점
 */

function doGet(e) {
  const cfg = getConfig();
  const template = HtmlService.createTemplateFromFile('Index');
  template.appTitle = cfg.title;
  return template.evaluate()
    .setTitle(cfg.title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Index.html 안에서 CSS·JS 파일을 끼워 넣을 때 씁니다. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
