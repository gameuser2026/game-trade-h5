// Vercel Serverless 入口：复用 server.js 的请求处理器
const { handler } = require('../server.js');

module.exports = handler;
