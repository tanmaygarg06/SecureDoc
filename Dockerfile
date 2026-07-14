FROM node:alpine
WORKDIR /app
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm install
COPY backend ./backend
COPY frontend ./frontend
EXPOSE 80
CMD ["node", "backend/server.js"]
