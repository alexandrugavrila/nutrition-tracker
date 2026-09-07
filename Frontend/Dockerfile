# Development stage
FROM node:24-slim AS dev
WORKDIR /app
COPY Frontend/package*.json ./
RUN npm install
COPY Frontend/ .
CMD ["npm", "run", "dev"]

# Build stage
FROM node:24-slim AS build

WORKDIR /app
COPY Frontend/package*.json ./
RUN npm install
COPY Frontend/ .
RUN npm run build

# Serve with nginx
FROM nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY Frontend/nginx.conf /etc/nginx/conf.d/default.conf
