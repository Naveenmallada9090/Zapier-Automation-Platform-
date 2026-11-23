FROM node:22-bookworm-slim

ARG SERVICE

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY ${SERVICE}/package*.json ./
RUN npm install

COPY ${SERVICE}/ ./

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
