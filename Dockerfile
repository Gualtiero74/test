# Dockerfile
FROM node:20-alpine

# Imposta la directory di lavoro nel container
WORKDIR /usr/src/app

# Copia i file dei pacchetti e installa le dipendenze
COPY package.json ./
RUN npm install --only=production

# Copia il resto del codice dell'applicazione
COPY . .

# L'applicazione risponde sulla porta 80
EXPOSE 80

# Comando per avviare l'applicazione
CMD [ "npm", "start" ]
