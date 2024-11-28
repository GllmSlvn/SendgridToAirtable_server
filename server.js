require('dotenv').config(); // Charger les variables d'environnement
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');
const winston = require('winston');

const app = express();
const port = process.env.PORT || 3000;

// Vérification de l'URL d'Airtable
if (!process.env.AIRTABLE_WEBHOOK_URL) {
    throw new Error('La variable d\'environnement AIRTABLE_WEBHOOK_URL n\'est pas définie. Veuillez l\'ajouter dans le fichier .env.');
}

// Configuration du logger avec winston
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json({ space: 2 })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({
            filename: path.join(__dirname, 'webhooks.log'),
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json({ space: 2 })
            )
        })
    ],
});

app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.status(200).send('Serveur en ligne');
});

async function sendToAirtableWithRetry(event) {
    const airtableWebhookUrl = process.env.AIRTABLE_WEBHOOK_URL;
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
        try {
            await axios.post(airtableWebhookUrl, event);

            logger.info('Données envoyées à Airtable avec succès', { event });
            return;
        } catch (error) {
            if (error.response && error.response.status === 429) {
                const waitTime = Math.pow(2, retryCount) * 1000;
                logger.warn(`Erreur 429 détectée. Réessayer après ${waitTime} ms...`, { error });
                await new Promise(resolve => setTimeout(resolve, waitTime));
                retryCount++;
            } else {
                logger.error('Erreur lors de l\'envoi à Airtable', { error: error.message });
                throw error;
            }
        }
    }
    logger.error('Échec de l\'envoi après plusieurs tentatives.');
    throw new Error('Échec de l\'envoi après plusieurs tentatives.');
}

function filterEvents(events) {
    return events.filter(event => event.event !== 'processed');
}

app.post('/', async (req, res) => {
    const events = req.body;

    if (Array.isArray(events)) {
        const filteredEvents = filterEvents(events);

        try {
            const promises = filteredEvents.map(event => sendToAirtableWithRetry(event));
            await Promise.all(promises);

            logger.info('Tous les événements ont été envoyés à Airtable avec succès');
            res.send('Données traitées avec succès');
        } catch (error) {
            logger.error('Erreur lors de l\'envoi des données à Airtable', { error: error.message });
            res.status(500).send('Erreur lors du traitement des données');
        }
    } else {
        res.status(400).send('Format des données incorrect : un tableau d\'événements était attendu');
    }
});

app.listen(port, () => {
    logger.info(`Serveur écoutant sur le port ${port}`);
});
