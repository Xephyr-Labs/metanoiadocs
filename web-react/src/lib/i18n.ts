export type Language = 'en' | 'zh-TW';

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'zh-TW', label: '繁體中文' },
];

const STORAGE_KEY = 'metanoiadocs-language';

const zhTW: Record<string, string> = {
  // Settings
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

  // Appearance
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
  'Customize how Metanoia looks and behaves for you.':
    '自訂 Metanoia 的外觀與使用方式。',

  // Authentication
  'Sign in': '登入',
  'Sign out': '登出',
  'Log out': '登出',

  // Main navigation
  Search: '搜尋',
  Home: '首頁',
  Documents: '文件',
  Tasks: '任務',
  Projects: '專案',
  Inbox: '收件匣',
  Favorites: '收藏',
  Tags: '標籤',
  Trash: '垃圾桶',

  // Common actions
  Share: '分享',
  Comment: '評論',
  Comments: '評論',
  Notifications: '通知',

  'Loading…': '載入中…',
  'Loading...': '載入中…',

  Close: '關閉',
  Delete: '刪除',
  Edit: '編輯',
  Done: '完成',
  Back: '返回',
  Next: '下一步',
  Everything: '全部',

  // Sidebar
  'All documents': '所有文件',
  Recent: '最近',
  Pinned: '釘選',
  Folders: '資料夾',
  Private: '私人',
  'Public links': '公開連結',
  'Shared with me': '與我分享',
  Designs: '設計',
  Templates: '範本',

  'New page': '新增頁面',
  'New task': '新增任務',

  'New database': '新增資料庫',
  'New data database': '新增資料資料庫',
  'New project': '新增專案',
  'New design': '新增設計',
  'New folder': '新增資料夾',

  'Show fewer': '顯示較少',
  more: '更多',

  'Import…': '匯入…',

  'Close sidebar': '關閉側邊欄',
  'Resize sidebar': '調整側邊欄大小',
  'Sidebar sections': '側邊欄區段',

  'Expand the panel': '展開面板',
  'Collapse the panel': '收合面板',

  // Database actions
  'New database under': '在此資料庫下新增資料庫',
  'New database under {{name}}': '在「{{name}}」下新增資料庫',
  'Actions for': '操作',
  'Actions for {{name}}': '「{{name}}」的操作',
  'Open in a new tab': '在新分頁開啟',
  'Copy link': '複製連結',
  'New database inside': '在其中新增資料庫',
  'New data database inside': '在其中新增資料資料庫',
  'Turn into a task database': '轉為任務資料庫',
  'Turn into a data database': '轉為資料資料庫',
  'Archive database': '封存資料庫',

  'Database name…': '資料庫名稱…',
  'New database name': '新資料庫名稱',

  // Pages / templates
  'New page from': '從此範本新增頁面',
  'New page from {{title}}': '從「{{title}}」新增頁面',

  'Create document': '建立文件',
  'Create task': '建立任務',

  'No documents yet.': '目前沒有文件。',
  'No tasks yet.': '目前沒有任務。',

  // Tags
  'Show pages': '顯示頁面',
  'Delete tag': '刪除標籤',
  'Delete the tag "{{name}}"?':
    '確定要刪除標籤「{{name}}」嗎？',
  'Delete the tag "{{name}}"? It is on {{count}} pages.':
    '確定要刪除標籤「{{name}}」嗎？此標籤目前套用於 {{count}} 個頁面。',
  'Deleted the tag {{name}}.':
    '已刪除標籤「{{name}}」。',

  // Database state changes
  'Could not change {{name}}.':
    '無法變更「{{name}}」。',

  '{{name}} is a data database. Its task fields are hidden, not deleted.':
    '「{{name}}」是資料資料庫，任務欄位已隱藏但未刪除。',

  '{{name}} is a task database again.':
    '「{{name}}」已恢復為任務資料庫。',

  'Could not archive {{name}}.':
    '無法封存「{{name}}」。',

  'Archived {{name}}.':
    '已封存「{{name}}」。',

  'Could not restore {{name}}.':
    '無法復原「{{name}}」。',

  Undo: '復原',

  // Fallback user label
  User: '使用者',
};

// Strings that are still hard-coded in React components.  This keeps the
// existing UI translatable while those components are gradually migrated to t().
const zhTWStaticUI: Record<string, string> = {
  Navigation: '導覽', Main: '主要導覽', Docs: '文件', Menu: '選單', Refresh: '重新整理',
  'Back to sign in': '返回登入', 'Forgot password?': '忘記密碼？', 'Full name': '姓名',
  'Try again': '再試一次', 'Nothing has been changed. Your content is safe on the server.': '沒有任何內容被變更，你的內容仍安全儲存在伺服器上。',
  'How to show these tasks': '任務顯示方式', 'Which tasks': '顯示哪些任務', Link: '連結',
  'More formatting': '更多格式', 'Export as PNG': '匯出為 PNG', 'Editor mode': '編輯器模式',
  'New slide': '新增投影片', 'No slides yet.': '目前沒有投影片。', Present: '簡報播放',
  'View­ing — the page is read-only here.': '檢視中 — 此頁面目前為唯讀。', 'No page open': '尚未開啟頁面',
  'Table of contents': '目錄', 'Add a property': '新增屬性', 'Property name': '屬性名稱', 'Property type': '屬性類型',
  'Change page icon': '變更頁面圖示', 'No tags yet. Type to create one.': '目前沒有標籤，輸入文字即可建立。',
  'Search or create a tag…': '搜尋或建立標籤…', 'Couldn’t load linked pages.': '無法載入連結頁面。',
  'Linked pages': '連結頁面', 'Links from this page': '此頁面的連出連結', 'Links to this page': '連到此頁面的連結',
  'Keyboard shortcuts': '鍵盤快捷鍵', 'Nothing here': '這裡目前沒有內容',
  'This embedded database isn’t available here.': '此處無法使用這個嵌入式資料庫。', 'That database no longer exists.': '該資料庫已不存在。',
  'Pick a database…': '選擇資料庫…', 'Database settings': '資料庫設定', 'Open this database': '開啟此資料庫', 'Resize database': '調整資料庫大小',
  'Checking…': '檢查中…', 'Intake form': '收集表單', 'Replace it': '取代', 'Turn it off': '關閉', 'New address': '新網址', 'Turn off the form': '關閉表單',
  'Task title': '任務標題', 'Open as page': '以頁面開啟', 'Task page actions': '任務頁面操作', 'Edit task types': '編輯任務類型',
  None: '無', Empty: '空白', 'Remove dependency': '移除相依關係', 'Open this page': '開啟此頁面', 'Pick a page…': '選擇頁面…',
  'Delete task': '刪除任務', 'Linked from': '連結來源', 'Remove this link': '移除此連結',
  'No comments yet.': '目前沒有評論。', '(edited)': '（已編輯）', 'Edit this comment': '編輯此評論', 'Delete this comment': '刪除此評論',
  'Add a comment…  @ to mention': '新增評論… 輸入 @ 提及成員', 'Post comment': '送出評論', 'No rows yet.': '目前沒有資料列。',
  'Every property is hidden in this view.': '此檢視中的所有屬性皆已隱藏。', 'Resize column': '調整欄寬', 'Long text': '長文字',
  Agent: '代理程式', 'Hand this to…': '交給…', 'Previous month': '上個月', 'Next month': '下個月', 'Date shown': '顯示日期',
  'No templates yet.': '目前沒有範本。', 'New template': '新增範本', 'All templates': '所有範本', Icon: '圖示', 'Template name': '範本名稱',
  Assignees: '負責人', 'Search people…': '搜尋成員…', 'Card size': '卡片大小', 'No tasks match this view.': '沒有符合此檢視的任務。',
  'Nothing has been finished in the last eight weeks.': '過去八週沒有完成任何任務。', Burndown: '燃盡圖', Velocity: '速度', Throughput: '完成量', Status: '狀態', Workload: '工作量',
  Value: '值', 'Choose…': '選擇…', Field: '欄位', Condition: '條件', 'Remove filter': '移除篩選條件', 'Sort by': '排序依據',
  'Everything is sorted already.': '所有項目都已排序。', Applying: '套用中', 'Clear selection': '清除選取', 'Add an action…': '新增動作…',
  'New type…': '新增類型…', 'New type name': '新類型名稱', 'New sprint': '新增 Sprint', 'Sprint name…': 'Sprint 名稱…', Backlog: '待辦清單',
  'Add task': '新增任務', 'Sprint progress': 'Sprint 進度', 'Sprint actions': 'Sprint 操作', 'Sprint start': 'Sprint 開始', 'Sprint end': 'Sprint 結束',
  'No project selected': '尚未選擇專案', 'Change database icon': '變更資料庫圖示', 'Start from a template': '從範本開始', 'Sprint scope': 'Sprint 範圍',
  'On this page': '此頁面', 'Select text in the page to comment on it.': '選取頁面中的文字即可加入評論。',
  'The text this was about has since changed.': '這則評論所對應的文字已經變更。', 'Replace with': '取代為', Reply: '回覆', 'Reply…': '回覆…', 'Send reply': '送出回覆',
  'Suggested change': '建議變更', 'Remove quote': '移除引用', 'New chat': '新對話', 'Attach this page': '附加此頁面', Stop: '停止', Send: '傳送',
  'No headings yet': '目前沒有標題', 'Quick capture': '快速新增', 'What needs doing?': '需要做什麼？', Saving: '儲存中', 'Which database': '選擇資料庫', 'Pick a database': '選擇資料庫',
  'Filter by name or tag…': '依名稱或標籤篩選…', 'Filter documents': '篩選文件', 'Which documents': '顯示哪些文件', Sort: '排序',
  'Your profile and how others see you.': '你的個人資料以及其他人看到的資訊。', 'Changing it signs out every other browser and device you’re on.': '變更後會登出其他瀏覽器與裝置。',
  Theme: '主題', Enabled: '啟用', 'Provider URL': '服務提供者 URL', Model: '模型', 'API key': 'API 金鑰',
  'Version and workspace information.': '版本與工作區資訊。', 'Token name (e.g. Claude MCP)…': 'Token 名稱（例如 Claude MCP）…',
  'No tokens yet.': '目前沒有 Token。', 'Copy your token now — it won’t be shown again.': '請立即複製 Token，之後將不會再次顯示。',
  'Nothing sent yet.': '目前尚未傳送任何內容。', 'Send a test': '傳送測試', 'New secret': '新增密鑰', 'Recent deliveries': '最近傳送紀錄', 'No webhooks yet.': '目前沒有 Webhook。',
  Back: '返回', 'Open sidebar': '開啟側邊欄', Breadcrumb: '麵包屑導覽', 'Ask AI': '詢問 AI', 'Chat with this page': '與此頁面對話', 'Side panel': '側邊面板', More: '更多',
  'Not now': '稍後再說', You: '你', 'Jump back in': '繼續最近工作', 'Recently opened': '最近開啟', 'All projects': '所有專案',
  'My documents': '我的文件', 'Previous page': '上一頁', 'Next page': '下一頁', 'My open tasks': '我的未完成任務', Overdue: '已逾期', 'Due this week': '本週到期', 'Docs this week': '本週文件',
  'Version history': '版本紀錄', Versions: '版本', Viewing: '檢視中', 'View name': '檢視名稱',
  'Waiting for someone who can edit the page.': '正在等待可編輯此頁面的人員。',
  'You can read this page’s comments. Ask its owner for comment access to join in.': '你可以閱讀此頁面的評論；若要參與討論，請向擁有者要求評論權限。',
  'You can view this page': '你可以檢視此頁面', 'What do you need?': '你需要什麼？',
  'What happened, what you expected, where to look': '發生了什麼、你原本預期什麼，以及需要查看的位置',
  'What people with the link can do': '擁有連結的人可以執行的操作', 'Which column…': '選擇欄位…',
  'Visibility (owner controls this)': '可見性（由擁有者控制）', 'Waits on': '等待項目',
  'Untitled': '未命名', 'Search people…': '搜尋成員…', 'No header': '無標題列',
  'Import CSV': '匯入 CSV', 'Export CSV': '匯出 CSV', 'Create missing properties': '建立缺少的屬性',
  'Download': '下載', 'Upload': '上傳', 'Rename': '重新命名', 'Duplicate': '建立副本',
  'Restore': '復原', 'Archive': '封存', 'Move': '移動', 'Add': '新增', 'Create': '建立',
  'Today': '今天', 'Tomorrow': '明天', 'Yesterday': '昨天', 'This week': '本週',
  'Owner': '擁有者', 'Viewer': '檢視者', 'Member': '成員', 'Guests': '訪客', 'People': '成員',
  'Description': '說明', 'Type': '類型', 'Date': '日期', 'Created': '建立時間', 'Updated': '更新時間',
  'Filter': '篩選', 'Group': '分組', 'Properties': '屬性', 'Views': '檢視', 'Board': '看板', 'Table': '表格', 'Calendar': '行事曆', 'Gallery': '圖庫',
  'Open': '開啟', 'Apply': '套用', 'Clear': '清除', 'Reset': '重設', 'Confirm': '確認', 'Continue': '繼續',
  'Add property': '新增屬性', 'Add filter': '新增篩選條件', 'Add sort': '新增排序', 'Add view': '新增檢視',
  'No results': '沒有結果', 'No results found.': '找不到結果。', 'Search…': '搜尋…', 'Search...': '搜尋…',

  // Home / dashboard
  'Still up': '還沒睡啊', 'Good morning': '早安', 'Good afternoon': '午安', 'Good evening': '晚安',
  'Import': '匯入', 'My tasks': '我的任務', 'Activity': '活動紀錄', 'No activity yet': '目前沒有活動紀錄',
  'Edits and comments land here.': '編輯與評論紀錄會顯示在這裡。', 'No projects yet': '目前沒有專案',
  'A project holds tasks with a board, table, gantt and calendar.': '專案可集中管理任務，並以看板、表格、甘特圖與行事曆檢視。',
  'Nothing assigned to you': '目前沒有指派給你的任務', 'Tasks you own show up here.': '你負責的任務會顯示在這裡。',
  'No documents yet': '目前沒有文件', 'Pages you create show up here.': '你建立的頁面會顯示在這裡。',
  'Filter tasks by project': '依專案篩選任務', 'You’re all caught up': '目前都處理完了', "You're all caught up": '目前都處理完了',
  '@-mentions, comments on your pages, tasks assigned to you and your daily task summary show up here.': '提及你的內容、頁面評論、指派給你的任務與每日任務摘要會顯示在這裡。',

  // Documents / editor
  'No pages': '目前沒有頁面', 'No pages carry these tags yet.': '目前沒有頁面使用這些標籤。',
  'Create your first page to start writing.': '建立第一個頁面開始撰寫內容。',
  'adds a 16:9 frame to the canvas.': '會在畫布新增一個 16:9 畫面。', 'Suggesting': '建議模式', 'Suggesting.': '建議模式',
  'to propose changes.': '以提出修改建議。', 'Shared': '已分享', 'Notes': '備註',
  'Add H1–H3 headings to build an outline.': '新增 H1–H3 標題即可建立大綱。',
  'Drag to resize · arrow keys to nudge · double-click or Backspace to reset': '拖曳調整大小 · 方向鍵微調 · 雙擊或按 Backspace 重設',
  'Search for a property…': '搜尋屬性…', 'Edit this address': '編輯此網址', 'Edit types…': '編輯類型…',
  'Built in': '內建', 'Yours': '自訂', 'No custom properties yet.': '目前沒有自訂屬性。', 'Link to…': '連結至…',
  'A built-in keeps its type': '內建屬性會保留原本類型', 'Add options… separate with commas': '新增選項…請以逗號分隔',
  'Add these options': '新增這些選項', 'Property name…': '屬性名稱…', 'No focus areas yet — type to make one.': '目前沒有焦點領域，輸入文字即可建立。',
  'Focus areas are edited on the task’s page': '焦點領域可在任務頁面中編輯', 'Search or create…': '搜尋或建立…',
  'Through…': '透過…', 'Relation to follow': '要追蹤的關聯', 'Property to read': '要讀取的屬性', 'How to reduce it': '彙總方式',

  // Projects / tasks
  'Actions': '操作', 'Sprint': 'Sprint', 'New': '新增', 'Bug report': '錯誤回報', 'Title': '標題', 'Column': '欄位',
  'Condition value': '條件值', 'Assign to': '指派給', 'Remove this action': '移除此動作', 'Condition field': '條件欄位',
  'Condition operator': '條件運算子', 'Remove this condition': '移除此條件', 'Rule name': '規則名稱', 'Name this rule': '為規則命名',
  'Trigger': '觸發條件', 'Days without a change': '未變更天數', 'Add an action': '新增動作', 'Automations': '自動化',
  'Import another': '再匯入一份', 'Start over': '重新開始', 'Import a CSV': '匯入 CSV', 'Goes to': '對應至', '(no header)': '（無標題列）',
  'Nothing scheduled': '目前沒有排程', 'Give a task a start or due date and it appears on the timeline.': '為任務設定開始日或到期日後，就會顯示在時間軸上。',
  'Timeline zoom': '時間軸縮放', 'This type no longer exists — reopen the project to resync': '此類型已不存在，請重新開啟專案以同步。',
  'Add a view': '新增檢視', 'Type name': '類型名稱', 'Task types': '任務類型', 'New type colour': '新類型顏色',
  'Start': '開始', 'Complete': '完成', 'Drag tasks here to plan this sprint.': '將任務拖曳到這裡以規劃此 Sprint。',
  'Nothing waiting. Every task is in a sprint.': '目前沒有等待安排的任務，所有任務都已加入 Sprint。', 'Sprints': 'Sprint',
  'Story points': '故事點數', 'Add task to backlog': '新增任務至待辦清單', 'No sprint has been completed yet.': '目前還沒有已完成的 Sprint。',
  'average per sprint': '每個 Sprint 平均', 'finished in eight weeks': '八週內完成', 'No open work in this view.': '此檢視目前沒有進行中的工作。',
  'No estimates yet — put hours on a task and this fills in.': '目前沒有工時估算；在任務中填入工時後，這裡就會顯示資料。',
  'Nothing to chart yet': '目前沒有可繪製的資料', 'Add tasks, and a sprint to put them in, and this fills itself in.': '新增任務並將它們加入 Sprint 後，這裡會自動顯示資料。',
  'completed sprints': '已完成 Sprint', 'tasks per week': '每週任務數', 'right now': '目前', 'open hours per person': '每人未完成工時',
  'nobody': '無人', 'the active sprint': '目前 Sprint', 'the backlog': '待辦清單', 'only when': '僅當', 'choose…': '選擇…',
  'when': '當', 'a task is created': '建立任務時', 'someone is assigned': '指派成員時', 'it is due today': '今天到期時',
  'it is overdue': '逾期時', 'nothing has changed in': '沒有變更達', 'run by hand, from a task': '從任務手動執行', 'days': '天',
  'Pick a sprint above to see it burn down.': '在上方選擇 Sprint 以查看燃盡圖。',

  // Review / comments / public pages
  'Review': '審閱', 'On this task': '此任務', 'Show': '顯示', 'New text (leave empty to suggest deleting it)': '新文字（留空代表建議刪除）',
  'Remove this page from the chat': '從對話中移除此頁面', 'Make a database first — a captured line has to live somewhere.': '請先建立資料庫，快速新增的內容需要儲存位置。',
  'save': '儲存', 'save & keep going': '儲存並繼續', 'Unfiled': '未歸檔', 'Add a note for the reviewer (optional)': '新增給審閱者的備註（選填）',
  '(formatting or type changed)': '（格式或類型已變更）', 'Back to the page': '返回頁面', 'Nothing left to review here.': '這裡已沒有待審閱的內容。', 'Decline': '拒絕',
  'No account needed. Anyone with this link can read what you write.': '不需要帳號，任何擁有此連結的人都能閱讀你寫的內容。',
  'Edit comment': '編輯評論', 'Delete comment': '刪除評論', 'Close comments': '關閉評論',
  'Select text in the page to comment on it, or add a comment below.': '選取頁面文字即可針對內容評論，也可以直接在下方新增評論。',
  'Send comment': '送出評論', 'Page unavailable': '頁面無法使用', 'Go to MetanoiaDocs': '前往 MetanoiaDocs', 'Open comments': '開啟評論',
  'Choose one…': '選擇一項…', 'Nothing to choose from yet.': '目前沒有可選項目。', 'Form unavailable': '表單無法使用',
  'It is logged as': '紀錄編號為', 'One line — the headline': '一行文字 — 標題', 'So they can come back to you': '讓對方可以聯絡你',

  // Sharing / navigation / folders
  'Share this page': '分享此頁面', 'People with access': '具有存取權的人員', 'Everyone in the workspace': '工作區中的所有人',
  'People with the link': '擁有連結的人', 'Invite by email…': '透過電子郵件邀請…', 'Access for the person you invite': '受邀者的存取權限',
  'Access for everyone in the workspace': '工作區所有人的存取權限', 'Page actions': '頁面操作', 'Document actions': '文件操作',
  'Folder actions': '資料夾操作', 'New page in folder': '在資料夾中新增頁面', 'More reactions': '更多表情回應', 'Drop a file here, or': '將檔案拖曳到這裡，或',
  'Pages': '頁面', 'Empty trash': '清空垃圾桶', 'Trash is empty': '垃圾桶是空的', 'Possible duplicate': '可能重複',
  'Go home': '回首頁', 'Nothing filed here yet': '這裡目前沒有已歸檔內容', 'Add a page, or drag one into this folder in the sidebar.': '新增頁面，或從側邊欄將頁面拖曳到此資料夾。',
  'Frames': '畫面', 'Command palette': '命令面板', 'Search pages, tasks (MD-14) or type a command…': '搜尋頁面、任務（MD-14）或輸入指令…', 'Searching': '搜尋中', '· Current': '· 目前',

  // History / intelligence
  'Help info': '說明資訊', 'last 50': '最近 50 個', 'are kept for this page.': '版本會保留在此頁面。', 'Back to doc': '返回文件',
  'Restore current version': '復原目前版本', 'Restore this version?': '要復原此版本嗎？', 'Before restore': '復原前', 'so you can come straight back.': '因此你可以隨時回到這個版本。',
  'Back to versions': '返回版本列表', 'Dismiss': '關閉', 'No versions yet': '目前沒有版本紀錄', 'Snapshots are saved as you edit, and whenever you ask for one.': '編輯時會自動儲存快照，也可以手動建立快照。',
  'More history actions': '更多版本紀錄操作', 'Couldn’t load intelligence.': '無法載入智慧分析。', "Couldn't load intelligence.": '無法載入智慧分析。',
  'Summary': '摘要', 'unresolved': '未解決', 'Nothing to surface yet': '目前沒有需要顯示的內容',
  'As you write, this rail highlights tasks, decisions, deadlines, related pages and missing links.': '撰寫內容時，這裡會標示任務、決策、截止日期、相關頁面與缺少的連結。',
  'Decisions': '決策', 'Deadlines': '截止日期', 'Related': '相關內容', 'Missing links': '缺少的連結', 'Risks': '風險', 'Changed deps': '已變更的相依項目',
  'Collaborators': '協作者', 'Terminology': '術語',

  // Settings / auth / system
  'Tag': '標籤', 'Keep': '保留', 'Guest': '訪客', 'Offline': '離線', '(you)': '（你）', 'for everyone.': '供所有人使用。',
  'Add a provider URL, a model and a key before turning it on.': '啟用前請先加入服務提供者 URL、模型與 API 金鑰。',
  'Anything signed in with this token stops working.': '所有使用此 Token 登入的服務都會停止運作。',
  'Calendar address': '行事曆網址', 'Invite a teammate by email…': '透過電子郵件邀請團隊成員…', 'Copy secret': '複製密鑰',
  'Verifying a delivery': '驗證傳送內容', 'Edits to an open page are saved in this browser and sync when you reconnect. Boards, tables and comments need the network.': '已開啟頁面的編輯內容會先儲存在此瀏覽器，重新連線後同步；看板、表格與評論需要網路連線。',
};

function translateStaticUIValue(value: string): string {
  if (currentLanguage !== 'zh-TW') return value;

  // Prefer an exact translation first. React often splits one sentence around
  // <strong>, icons, counters, and other inline elements, so a visible text
  // node can also contain a translated phrase plus dynamic content. In that
  // case translate the known phrases without touching URLs, IDs, or code.
  const exact = zhTW[value] ?? zhTWStaticUI[value];
  if (exact) return exact;

  // Dynamic UI text that cannot be represented by one literal dictionary key.
  let match = value.match(/^(\d+)d ago$/);
  if (match) return `${match[1]} 天前`;
  match = value.match(/^(\d+)h ago$/);
  if (match) return `${match[1]} 小時前`;
  match = value.match(/^(\d+)m ago$/);
  if (match) return `${match[1]} 分鐘前`;
  match = value.match(/^(Still up|Good morning|Good afternoon|Good evening),\s*(.+)$/);
  if (match) return `${zhTWStaticUI[match[1]] ?? match[1]}，${match[2]}`;
  match = value.match(/^(.+) edited (.+)$/);
  if (match) return `${match[1]} 編輯了 ${match[2]}`;
  match = value.match(/^(.+) created (.+)$/);
  if (match) return `${match[1]} 建立了 ${match[2]}`;

  let result = value;
  const phrases = Object.entries({ ...zhTWStaticUI, ...zhTW })
    .filter(([source]) => source.length >= 3 && /[A-Za-z]/.test(source))
    .sort(([a], [b]) => b.length - a.length);

  for (const [source, target] of phrases) {
    if (result.includes(source)) result = result.replaceAll(source, target);
  }
  return result;
}

function translateDOMNode(node: Node): void {
  if (currentLanguage !== 'zh-TW') return;
  if (node.nodeType === Node.TEXT_NODE) {
    const raw = node.textContent ?? '';
    const trimmed = raw.trim();
    if (!trimmed) return;
    const translated = translateStaticUIValue(trimmed);
    if (translated !== trimmed) node.textContent = raw.replace(trimmed, translated);
    return;
  }
  if (!(node instanceof Element)) return;
  for (const attr of ['placeholder', 'title', 'aria-label', 'alt']) {
    const raw = node.getAttribute(attr);
    if (!raw) continue;
    const translated = translateStaticUIValue(raw);
    if (translated !== raw) node.setAttribute(attr, translated);
  }
  for (const child of Array.from(node.childNodes)) translateDOMNode(child);
}

export function installDOMTranslations(): void {
  if (currentLanguage !== 'zh-TW') return;
  const run = () => translateDOMNode(document.body);
  if (document.body) run();
  else window.addEventListener('DOMContentLoaded', run, { once: true });

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') translateDOMNode(mutation.target);
      for (const node of Array.from(mutation.addedNodes)) translateDOMNode(node);
      if (mutation.type === 'attributes') translateDOMNode(mutation.target);
    }
  });
  const start = () => observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label', 'alt'] });
  if (document.body) start();
  else window.addEventListener('DOMContentLoaded', start, { once: true });
}

let currentLanguage: Language = 'en';

function translate(text: string): string {
  if (currentLanguage === 'en') {
    return text;
  }

  return zhTW[text] ?? text;
}

export function t(
  text: string,
  vars?: Record<string, string | number>,
): string {
  let result = translate(text);

  for (const [key, value] of Object.entries(vars ?? {})) {
    result = result.replaceAll(`{{${key}}}`, String(value));
  }

  return result;
}

export function getLanguage(): Language {
  return currentLanguage;
}

export function initLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (saved === 'en' || saved === 'zh-TW') {
    currentLanguage = saved;
  } else {
    currentLanguage = 'en';
  }

  return currentLanguage;
}

export function changeLanguage(language: Language): void {
  if (language === currentLanguage) {
    return;
  }

  currentLanguage = language;
  localStorage.setItem(STORAGE_KEY, language);

  window.location.reload();
}
