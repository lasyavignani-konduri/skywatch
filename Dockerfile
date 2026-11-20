FROM node:22-slim

WORKDIR /app

# Copy dependency definitions
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy all application files
COPY . .

ENV PORT=8000
ENV NODE_ENV=production

EXPOSE 8000

CMD ["node", "server.js"]
