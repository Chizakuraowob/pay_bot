// 把 client 實例抽出來，避免 bot/index.js 與 commands/notifier 互相循環引用
let clientInstance = null;

export function getClient() {
  return clientInstance;
}

export function setClient(c) {
  clientInstance = c;
}
