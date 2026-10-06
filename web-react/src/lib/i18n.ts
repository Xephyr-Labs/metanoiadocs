export type Language = 'en' | 'zh-TW';

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'zh-TW', label: '繁體中文' },
];

const STORAGE_KEY = 'metanoiadocs-language';

const zhTW: Record<string, string> = {
  Settings: '設定',
  Account: '帳號',
  Workspace: '工作區',
  'My account': '我的帳號',
  Preferences: '偏好設定',
  'API tokens': 'API Token',
  Members: '成員',
  AI: 'AI',
  Webhooks: 'Webhooks',
  About: '關於',

  Name: '名稱',
  Username: '使用者名稱',
  Email: '電子郵件',
  'Time zone': '時區',
  Password: '密碼',

  Change: '變更',
  'Change password': '變更密碼',
  'Current password': '目前密碼',
  'New password — at least 8 characters': '新密碼 — 至少 8 個字元',
  'New password again': '再次輸入新密碼',

  Cancel: '取消',
  Save: '儲存',
  Saved: '已儲存',

  Appearance: '外觀',
  'Pick a light or dark theme.': '選擇淺色或深色主題。',
  Light: '淺色',
  Dark: '深色',

  'Smaller text': '較小文字',
  'Reduce the editor font size.': '縮小編輯器文字大小。',

  'Desktop notifications': '桌面通知',
  'Email notifications': '電子郵件通知',
  'Test notifications': '測試通知',
  'Send test': '傳送測試',

  'Calendar subscription': '行事曆訂閱',
  Copy: '複製',
  Copied: '已複製',

  Invite: '邀請',
  'Invite by email': '透過電子郵件邀請',
  'Send invite': '傳送邀請',

  Role: '角色',
  Admin: '管理員',
  Collaborator: '協作者',
  Remove: '移除',

  Language: '語言',
  'Choose the language used by the interface.': '選擇介面使用的語言。',
  English: 'English',
  '繁體中文': '繁體中文',

  Version: '版本',
  Editor: '編輯器',
  Build: '建置',
  Plan: '方案',

  'Free · unlimited members, forever': '免費 · 永久不限成員',

  'Close settings': '關閉設定',
  'Sign in': '登入',
  'Sign out': '登出',
  Search: '搜尋',
  Home: '首頁',
  Documents: '文件',
  Tasks: '任務',
  Projects: '專案',
  Inbox: '收件匣',
  Favorites: '收藏',
  Tags: '標籤',
  Trash: '垃圾桶',

  'New page': '新增頁面',
  'New task': '新增任務',
  Share: '分享',
  Comment: '留言',
  Comments: '留言',
  Notifications: '通知',

  'Loading…': '載入中…',
  'Loading...': '載入中…',
  Close: '關閉',
  Delete: '刪除',
  Edit: '編輯',
  Done: '完成',
  Back: '返回',
  Next: '下一步',

  'Create document': '建立文件',
  'Create task': '建立任務',
  'No documents yet.': '目前沒有文件。',
  'No tasks yet.': '目前沒有任務。',
};

let currentLanguage: Language = 'en';

function translate(value: string): string {
  if (currentLanguage === 'zh-TW') {
    return zhTW[value] ?? value;
  }

  return value;
}

export function getLanguage(): Language {
  return currentLanguage;
}

export function setLanguage(language: Language) {
  currentLanguage = language;
  localStorage.setItem(STORAGE_KEY, language);
}

export function initLanguage() {
  const saved = localStorage.getItem(STORAGE_KEY);

  currentLanguage = saved === 'zh-TW' ? 'zh-TW' : 'en';

  document.documentElement.lang = currentLanguage;
}

export function changeLanguage(language: Language) {
  setLanguage(language);
  document.documentElement.lang = language;

  // React 重新載入後會使用新的語言設定。
  window.location.reload();
}

export function t(text: string): string {
  return translate(text);
}
