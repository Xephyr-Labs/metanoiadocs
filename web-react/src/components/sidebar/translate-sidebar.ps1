$file = Join-Path $PSScriptRoot "Sidebar.tsx"

$content = Get-Content $file -Raw

# Add i18n import
$content = $content -replace `
"import \{ toast \} from '../../lib/toast';", `
"import { toast } from '../../lib/toast';`r`nimport { t } from '../../lib/i18n';"

# Fixed navigation labels
$replacements = @{
    "label: 'Everything'" = "label: t('Everything')"
    "label: 'Documents'" = "label: t('Documents')"
    "label: 'Projects'" = "label: t('Projects')"
    "label: 'Designs'" = "label: t('Designs')"
    "label: 'Tags'" = "label: t('Tags')"
    "label: 'Templates'" = "label: t('Templates')"

    'label="Home"' = 'label={t(''Home'')}'
    'label="Inbox"' = 'label={t(''Inbox'')}'
    'label="Tasks"' = 'label={t(''Tasks'')}'
    'label="All documents"' = 'label={t(''All documents'')}'

    'label="Recent"' = 'label={t(''Recent'')}'
    'label="Pinned"' = 'label={t(''Pinned'')}'
    'label="Favorites"' = 'label={t(''Favorites'')}'
    'label="Private"' = 'label={t(''Private'')}'
    'label="Public links"' = 'label={t(''Public links'')}'
    'label="Shared with me"' = 'label={t(''Shared with me'')}'
    'label="Trash"' = 'label={t(''Trash'')}'

    'label="Settings"' = 'label={t(''Settings'')}'
    'label="Log out"' = 'label={t(''Log out'')}'

    "label: 'Import…'" = "label: t('Import…')"
    "label: 'Settings'" = "label: t('Settings')"
    "label: 'Log out'" = "label: t('Log out')"

    "label: 'New database'" = "label: t('New database')"
    "label: 'New data database'" = "label: t('New data database')"

    'aria-label="New database"' = 'aria-label={t(''New database'')}'
    'aria-label="New design"' = 'aria-label={t(''New design'')}'
    'aria-label="New folder"' = 'aria-label={t(''New folder'')}'

    'aria-label="Close sidebar"' = 'aria-label={t(''Close sidebar'')}'
    'aria-label="Resize sidebar"' = 'aria-label={t(''Resize sidebar'')}'

    'aria-label="Sidebar sections"' = 'aria-label={t(''Sidebar sections'')}'

    'title={`New page from ${t.title}`}' = 'title={`${t(''New page from'')} ${t.title}`}'

    'placeholder="Database name…"' = 'placeholder={t(''Database name…'')}'
    'label="New database name"' = 'label={t(''New database name'')}'
}

foreach ($pair in $replacements.GetEnumerator()) {
    $content = $content.Replace($pair.Key, $pair.Value)
}

# SectionLabel children
$content = $content.Replace(
@"
          >
            Projects
          </SectionLabel>
"@,
@"
          >
            {t('Projects')}
          </SectionLabel>
"@
)

$content = $content.Replace(
@"
          >
            Designs
          </SectionLabel>
"@,
@"
          >
            {t('Designs')}
          </SectionLabel>
"@
)

$content = $content.Replace(
@"
          >
            Folders
          </SectionLabel>
"@,
@"
          >
            {t('Folders')}
          </SectionLabel>
"@
)

# Empty-state buttons
$content = $content.Replace(
"> New project</button>",
"> {t('New project')}</button>"
)

$content = $content.Replace(
"> New design</button>",
"> {t('New design')}</button>"
)

$content = $content.Replace(
"> New folder</button>",
"> {t('New folder')}</button>"
)

# Capped
$content = $content.Replace(
"{all ? 'Show fewer' : `${items.length - limit} more`}",
"{all ? t('Show fewer') : `${items.length - limit} ${t('more')}`}"
)

# Save
Set-Content $file $content -Encoding UTF8

Write-Host ""
Write-Host "Sidebar.tsx 已完成 i18n 固定文字替換。" -ForegroundColor Green
Write-Host "請檢查 Git diff 後再 commit。" -ForegroundColor Yellow
