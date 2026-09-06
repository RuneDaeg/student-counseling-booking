// 로컬 미리보기 전용 정적 서버. 실제 배포와는 무관합니다.
//   sh tools/build-preview.sh && node tools/preview-server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.PORT || 5599);

http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, rel === '/' ? 'preview.html' : rel);
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404).end('tools/build-preview.sh 를 먼저 실행해 주세요.');
      return;
    }
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(buf);
  });
}).listen(port, () => console.log('미리보기: http://localhost:' + port));
