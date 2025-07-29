FROM node:20
RUN apt update && apt upgrade -y && apt install bash -y
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node","server.js"]