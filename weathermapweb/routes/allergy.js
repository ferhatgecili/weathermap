var express = require('express');
var https = require('https');

var router = express.Router();

function getJson(url) {
    return new Promise(function (resolve, reject) {
        https.get(url, function (response) {
            var rawData = '';
            response.on('data', function (chunk) {
                rawData += chunk;
            });
            response.on('end', function () {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error('HTTP ' + response.statusCode + ' - ' + rawData.slice(0, 200)));
                    return;
                }

                try {
                    resolve(JSON.parse(rawData));
                } catch (error) {
                    reject(new Error('JSON parse hatasi: ' + error.message));
                }
            });
        }).on('error', function (error) {
            reject(error);
        });
    });
}

function calculateRiskLevel(pollenValues, weatherValues) {
    var pollenScore = Math.max.apply(Math, pollenValues);
    var level = 'dusuk';

    if (pollenScore >= 180) {
        level = 'cok_yuksek';
    } else if (pollenScore >= 90) {
        level = 'yuksek';
    } else if (pollenScore >= 30) {
        level = 'orta';
    }

    if (
        (weatherValues.windspeed > 8 && weatherValues.temperature > 18) ||
        (weatherValues.humidity < 40 && pollenScore >= 25)
    ) {
        if (level === 'dusuk') {
            level = 'orta';
        } else if (level === 'orta') {
            level = 'yuksek';
        } else if (level === 'yuksek') {
            level = 'cok_yuksek';
        }
    }

    return {
        pollenScore: pollenScore,
        level: level
    };
}

function getNotification(level, name) {
    var person = name || 'Kullanici';

    if (level === 'cok_yuksek') {
        return '🚨 ' + person + ', alerji riski COK YUKSEK. Disari cikarken maske ve ilaclarini yanina al.';
    }

    if (level === 'yuksek') {
        return '⚠️ ' + person + ', alerji riski yuksek. Polenin yogun oldugu saatlerde disariyi sinirla.';
    }

    if (level === 'orta') {
        return 'ℹ️ ' + person + ', alerji riski orta. Belirti takibi yapman onerilir.';
    }

    return '✅ ' + person + ', alerji riski dusuk. Yine de guncel raporu takip et.';
}

router.get('/', async function (req, res) {
    var lat = req.query.lat;
    var lon = req.query.lon;
    var name = req.query.name;
    var notify = req.query.notify === 'true' || req.query.notify === '1';

    if (!lat || !lon) {
        res.status(400).json({
            error: 'lat ve lon query parametreleri zorunludur. Ornek: /api/allergy?lat=41.0082&lon=28.9784'
        });
        return;
    }

    try {
        var weatherUrl =
            'https://api.open-meteo.com/v1/forecast?latitude=' +
            encodeURIComponent(lat) +
            '&longitude=' +
            encodeURIComponent(lon) +
            '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code';

        var airQualityUrl =
            'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' +
            encodeURIComponent(lat) +
            '&longitude=' +
            encodeURIComponent(lon) +
            '&hourly=alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen,pm10,pm2_5,ozone';

        var responses = await Promise.all([getJson(weatherUrl), getJson(airQualityUrl)]);
        var weather = responses[0];
        var airQuality = responses[1];

        var currentWeather = {
            temperature: weather.current.temperature_2m,
            humidity: weather.current.relative_humidity_2m,
            windspeed: weather.current.wind_speed_10m,
            weatherCode: weather.current.weather_code
        };

        var pollenValues = [
            airQuality.hourly.alder_pollen[0] || 0,
            airQuality.hourly.birch_pollen[0] || 0,
            airQuality.hourly.grass_pollen[0] || 0,
            airQuality.hourly.mugwort_pollen[0] || 0,
            airQuality.hourly.olive_pollen[0] || 0,
            airQuality.hourly.ragweed_pollen[0] || 0
        ];

        var risk = calculateRiskLevel(pollenValues, currentWeather);
        var notification = getNotification(risk.level, name);

        if (notify) {
            console.log('ALERJI BILDIRIMI:', notification);
        }

        res.json({
            location: {
                latitude: Number(lat),
                longitude: Number(lon)
            },
            weather: currentWeather,
            pollen: {
                alder: pollenValues[0],
                birch: pollenValues[1],
                grass: pollenValues[2],
                mugwort: pollenValues[3],
                olive: pollenValues[4],
                ragweed: pollenValues[5]
            },
            risk: {
                level: risk.level,
                pollenScore: risk.pollenScore
            },
            notification: notification
        });
    } catch (error) {
        res.status(502).json({
            error: 'Harici hava/alergi servislerinden veri alinamadi.',
            details: error.message
        });
    }
});

module.exports = router;
