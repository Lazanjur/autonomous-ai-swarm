FROM node:20-alpine

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /workspace

COPY package.json /workspace/package.json
COPY apps/web/package.json /workspace/apps/web/package.json
RUN npm install

COPY apps/web /workspace/apps/web

WORKDIR /workspace/apps/web
RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000
CMD ["npm", "run", "start"]
