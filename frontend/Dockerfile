# Imagen de cada parte del frontend (shell o microfrontend), servida con nginx.
# Uso: docker build -f frontend/Dockerfile --build-arg APP=mfe-incidents frontend
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json webpack.common.js ./
COPY shared ./shared
COPY shell/package.json ./shell/
COPY mfe-incidents/package.json ./mfe-incidents/
COPY mfe-notifications/package.json ./mfe-notifications/
COPY mfe-audit/package.json ./mfe-audit/
RUN npm ci
COPY . .
ARG APP
RUN npm run build -w ${APP} && mv ${APP}/dist /out

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /out /usr/share/nginx/html
EXPOSE 80
