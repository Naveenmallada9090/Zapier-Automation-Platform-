FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . ./

ARG NEXT_PUBLIC_BACKEND_URL=http://localhost:3000
ARG NEXT_PUBLIC_HOOKS_URL=http://localhost:3002
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_HOOKS_URL=$NEXT_PUBLIC_HOOKS_URL

RUN npm run build

FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app ./

EXPOSE 3000

CMD ["sh", "-c", "npx next start -H 0.0.0.0 -p ${PORT:-3000}"]
