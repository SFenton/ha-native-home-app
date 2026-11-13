ARG BUILD_FROM=node:22-alpine
FROM ${BUILD_FROM} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
RUN npm run build

FROM ${BUILD_FROM}
ARG BUILD_ARCH
ARG BUILD_VERSION=0.1.0
LABEL io.hass.name="Native Home Studio" \
      io.hass.description="Server-driven Native Home configuration studio" \
      io.hass.arch="${BUILD_ARCH}" \
      io.hass.type="addon" \
      io.hass.version="${BUILD_VERSION}"
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4800 DATA_DIR=/data/studio
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/shared ./src/shared
COPY run.sh ./run.sh
RUN chmod 755 ./run.sh
EXPOSE 4800
CMD ["/app/run.sh"]
