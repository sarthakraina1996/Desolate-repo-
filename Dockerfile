FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Build the web app, then drop the packages only used for tests, formatting and the demo.
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    TRUST_PROXY=1
EXPOSE 3000
CMD ["npm", "start"]
