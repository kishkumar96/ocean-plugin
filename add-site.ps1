# PowerShell script to add a new plugin site
param(
    [Parameter(Mandatory=$true)]
    [string]$SiteName
)

Write-Host "🚀 Adding new plugin site: $SiteName" -ForegroundColor Green

# Create site directory
$siteDir = "plugin/$SiteName"
New-Item -ItemType Directory -Force -Path $siteDir | Out-Null

# Create basic HTML file
$htmlContent = @"
<html>
    <head>
        <title>$SiteName</title>
    </head>
    <body>
        <h1>$SiteName</h1>
        <p>This is the $SiteName plugin site.</p>
        <a href="/">← Back to Main</a>
    </body>
</html>
"@

Set-Content -Path "$siteDir/index.html" -Value $htmlContent

# Create Dockerfile
$dockerfileContent = @"
FROM nginx:alpine

# Copy the HTML files to nginx html directory
COPY index.html /usr/share/nginx/html/

# Copy a basic nginx configuration for this site
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
"@

Set-Content -Path "$siteDir/Dockerfile" -Value $dockerfileContent

# Create nginx.conf for the site
$nginxConfContent = @"
server {
    listen 80;
    server_name localhost;

    location / {
        root /usr/share/nginx/html;
        index index.html index.htm;
        try_files `$uri `$uri/ /index.html;
    }

    # Enable gzip compression
    gzip on;
    gzip_types text/css application/javascript text/javascript application/json;
    
    # Add security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
}
"@

Set-Content -Path "$siteDir/nginx.conf" -Value $nginxConfContent

# Create routing configuration
$routeConfContent = @"
location /$SiteName/ {
    proxy_pass http://plugin-$SiteName:80/;
    proxy_set_header Host `$host;
    proxy_set_header X-Real-IP `$remote_addr;
    proxy_set_header X-Forwarded-For `$proxy_add_x_forwarded_for;
    proxy_Set_header X-Forwarded-Proto `$scheme;
}
"@

Set-Content -Path "nginx/sites/$SiteName.conf" -Value $routeConfContent

Write-Host "✅ Site created successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Next steps:" -ForegroundColor Yellow
Write-Host "1. Add this service to docker-compose.yml:"
Write-Host ""
Write-Host "  plugin-$SiteName:" -ForegroundColor Cyan
Write-Host "    build: ./plugin/$SiteName" -ForegroundColor Cyan
Write-Host "    expose:" -ForegroundColor Cyan
Write-Host "      - `"80`"" -ForegroundColor Cyan
Write-Host "    container_name: plugin-$SiteName" -ForegroundColor Cyan
Write-Host ""
Write-Host "2. Add to depends_on in main-nginx service:" -ForegroundColor Yellow
Write-Host "      - plugin-$SiteName" -ForegroundColor Cyan
Write-Host ""
Write-Host "3. Run: docker-compose up --build -d" -ForegroundColor Yellow
Write-Host ""
Write-Host "🌐 Your site will be available at: http://localhost:8081/$SiteName/" -ForegroundColor Green
