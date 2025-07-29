FROM node:20
RUN apt-get update && apt-get install -y \
  libcairo2-dev \
  libjpeg-dev \
  libpango1.0-dev \
  libgif-dev \
  build-essential \
  g++ \
  bash
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node","server.js"]