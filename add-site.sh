#!/bin/bash

# Bash script to add a new plugin site
if [ $# -eq 0 ]; then
    echo "Usage: ./add-site.sh <site-name>"
    exit 1
fi

SITE_NAME="$1"

echo "🚀 Adding new plugin site: $SITE_NAME"

# Create site directory
mkdir -p "plugin/$SITE_NAME"

# Create basic HTML file
cat > "plugin/$SITE_NAME/index.html" << EOF
<html>
    <head>
        <title>$SITE_NAME</title>
    </head>
    <body>
        <h1>$SITE_NAME</h1>
        <p>This is the $SITE_NAME plugin site.</p>
        <a href="/">← Back to Main</a>
    </body>
</html>
EOF

# Create Dockerfile
cat > "plugin/$SITE_NAME/Dockerfile" << EOF
FROM nginx:alpine

# Copy the HTML files to nginx html directory
COPY index.html /usr/share/nginx/html/

# Copy a basic nginx configuration for this site
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
EOF

# Create nginx.conf for the site
cat > "plugin/$SITE_NAME/nginx.conf" << EOF
server {
    listen 80;
    server_name localhost;

    location / {
        root /usr/share/nginx/html;
        index index.html index.htm;
        try_files \$uri \$uri/ /index.html;
    }

    # Enable gzip compression
    gzip on;
    gzip_types text/css application/javascript text/javascript application/json;
    
    # Add security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
}
EOF

# Create routing configuration
cat > "nginx/sites/$SITE_NAME.conf" << EOF
location /$SITE_NAME/ {
    proxy_pass http://plugin-$SITE_NAME:80/;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
}
EOF

echo "✅ Site created successfully!"
echo ""
echo "📝 Next steps:"
echo "1. Add this service to docker-compose.yml:"
echo ""
echo "  plugin-$SITE_NAME:"
echo "    build: ./plugin/$SITE_NAME"
echo "    expose:"
echo "      - \"80\""
echo "    container_name: plugin-$SITE_NAME"
echo ""
echo "2. Add to depends_on in main-nginx service:"
echo "      - plugin-$SITE_NAME"
echo ""
echo "3. Run: docker-compose up --build -d"
echo ""
echo "🌐 Your site will be available at: http://localhost:8081/$SITE_NAME/"
