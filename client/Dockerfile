# Track AI Client - Production Dockerfile
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY . .

# Tell Vite to output to dist/ instead of ../server/public
ENV DOCKER_BUILD=true

# Build arguments for Vite
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config and entrypoint
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Set default API backend (override with -e when running container)
ENV API_BACKEND=http://server:5000

# Expose port
EXPOSE 80

# Environment variables for dynamic configuration
ENV PORT=80

# Use entrypoint to wait for backend and inject env variables before starting nginx
ENTRYPOINT ["/docker-entrypoint.sh"]
