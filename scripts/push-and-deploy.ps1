# GeoFileTools — push to GitHub + first Cloudflare Pages deploy
# Run from repo root after: gh auth login && npx wrangler login

$ErrorActionPreference = "Stop"
$gh = "C:\Program Files\GitHub CLI\gh.exe"
$repoName = "geofiletools"

Set-Location $PSScriptRoot\..

& $gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Run: gh auth login" }

$remote = git remote get-url origin 2>$null
if (-not $remote) {
  & $gh repo create $repoName --public --source=. --remote=origin --description "Browser-side GIS vector file converter"
  if ($LASTEXITCODE -ne 0) { throw "gh repo create failed" }
} else {
  git push -u origin main
  if ($LASTEXITCODE -ne 0) { throw "git push failed" }
}

if (-not $remote) {
  git push -u origin main
}

Write-Host "`nGitHub done. Deploying to Cloudflare Pages..."
npm run build
node scripts/prepare-pages-dist.mjs
npx wrangler pages project create $repoName --production-branch main 2>$null
npx wrangler pages deploy apps/web/dist --project-name $repoName --branch main

Write-Host "`nDone. Open Cloudflare Dashboard -> Workers & Pages -> $repoName for the *.pages.dev URL."
