FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production \
    PORT=3100 \
    DATA_DIR=/app/data \
    TRUST_PROXY=1
EXPOSE 3100
CMD ["npm", "start"]
