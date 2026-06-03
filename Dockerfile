# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

COPY package*.json ./
COPY frontend/package*.json frontend/
COPY server/package*.json server/

RUN npm ci

FROM deps AS build
WORKDIR /app

COPY . .

RUN npm run build
RUN npm prune --omit=dev

FROM gradle:9.5.1-jdk25-alpine AS gradle-runtime

FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV APP_ORIGIN=*
ENV GRADLE_DISTRIBUTION_URL=https://services.gradle.org/distributions/gradle-9.5.1-bin.zip
ENV JAVA_HOME=/opt/java/openjdk
ENV GRADLE_HOME=/opt/gradle
ENV GRADLE_COMMAND=/opt/gradle/bin/gradle
ENV PATH="${JAVA_HOME}/bin:${GRADLE_HOME}/bin:${PATH}"

COPY --from=gradle-runtime /opt/java/openjdk /opt/java/openjdk
COPY --from=gradle-runtime /opt/gradle /opt/gradle

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package*.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/frontend/dist ./frontend/dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["npm", "start"]
