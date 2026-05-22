#!/bin/sh
set -e

# Use PORT from environment or default to 80
export PORT="${PORT:-80}"

# Normalize API_BACKEND - ensure no trailing slash
API_BACKEND="${API_BACKEND:-http://server:5000}"
API_BACKEND=$(echo "$API_BACKEND" | sed 's:/*$::')
export API_BACKEND

case "$API_BACKEND" in
  http://*|https://*) ;;
  *)
    echo "ERROR: API_BACKEND must start with http:// or https:// (current: $API_BACKEND)"
    exit 1
    ;;
esac

# Extract backend host for SNI (if HTTPS is used)
# This removes protocol (http:// or https://) and any path/port
BACKEND_HOST_ONLY=$(echo "$API_BACKEND" | sed -e 's|^[^/]*//||' -e 's|/.*$||' -e 's|:.*$||')
export BACKEND_HOST_ONLY

echo "Client container starting..."
echo "PORT: $PORT"
echo "API_BACKEND: $API_BACKEND"
echo "BACKEND_HOST_ONLY: $BACKEND_HOST_ONLY"

# Wait for backend server to be ready before starting nginx
MAX_RETRIES=30
RETRY_INTERVAL=2

echo "Waiting for backend at $API_BACKEND/health ..."

for i in $(seq 1 $MAX_RETRIES); do
    if curl -s -f -o /dev/null "$API_BACKEND/health" 2>/dev/null; then
        echo "Backend is ready!"
        break
    fi
    if [ $i -eq $MAX_RETRIES ]; then
        echo "Warning: Backend not ready after $MAX_RETRIES attempts, starting nginx anyway..."
    else
        echo "Waiting for backend... ($i/$MAX_RETRIES)"
        sleep $RETRY_INTERVAL
    fi
done

# Extract nameserver for Nginx resolver
RAW_NS=$(cat /etc/resolv.conf | grep "nameserver" | awk '{print $2}' | head -n 1)
if [ -z "$RAW_NS" ]; then
    echo "No nameserver found in /etc/resolv.conf, using fallback 8.8.8.8"
    export NAMESERVER="8.8.8.8"
else
    # Wrap IPv6 addresses in square brackets for nginx resolver directive
    if echo "$RAW_NS" | grep -q ':'; then
        export NAMESERVER="[$RAW_NS]"
    else
        export NAMESERVER="$RAW_NS"
    fi
fi
echo "Using nameserver: $NAMESERVER"

# Use envsubst to inject environment variables into nginx config
echo "Substituting environment variables in nginx config..."
envsubst '$PORT $API_BACKEND $BACKEND_HOST_ONLY $NAMESERVER' < /etc/nginx/conf.d/default.conf > /tmp/default.conf
mv /tmp/default.conf /etc/nginx/conf.d/default.conf

# Start nginx
echo "Starting nginx..."
exec nginx -g "daemon off;"
