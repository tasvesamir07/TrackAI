#!/bin/bash

# Deploy script for Track AI
# Usage: ./deploy.sh [environment]

set -e

ENVIRONMENT=${1:-production}
IMAGE_TAG=${IMAGE_TAG:-latest}

echo "Deploying Track AI to $ENVIRONMENT (tag: $IMAGE_TAG)"

# Pull latest images
docker-compose pull

# Rebuild and restart services
docker-compose up -d --build

# Run database migrations if needed
docker-compose exec -T server npx prisma migrate deploy || echo "No migrations to run"

# Cleanup unused images
docker image prune -f

echo "Deployment complete!"