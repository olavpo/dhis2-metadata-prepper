const fs = require("fs");
const inquirer = require("inquirer");
const request = require("request");
const Q = require("q");

let metadata = false;
let serverInfo = false;

run();

async function run() {
	let metadataFilePath = filePath();
	if (!metadataFilePath) return;
		
	metadata = readFile(metadataFilePath);
	if (!metadata) return;

	operation();
}

async function operation() {
	let initialInput = [
		{
			type: "list",
			name: "operation",
			message: "Choose operation",
			choices: ["1. Update default dimension based on server", "2. Swap translations"]
		}
	];
	let {operation} = await inquirer.prompt(initialInput);
		
	switch (operation.charAt(0)) {
	case "1":
		defaultUpdate()
		break;
	case "2":
		translationSwap();
	default:
		console.log("Not implemented");
	}
}

/** SET DEFAULT */

async function defaultUpdate() {
	while (!serverInfo) serverInfo = await serverLogin();
	let serverDefaults = await getServerDefaults();
	if (!serverDefaults) return;
	let fileDefaults = getFileDefaults();
	if (setDefaultUid(fileDefaults, serverDefaults)) {
		let newFilePath = filePath().replace(".json", "_newDefaults.json");
		saveFile(metadata, newFilePath);
		console.log("Re-run script with this file if updating translations.");
	}
	else {
		console.log("Defaults in file and on server already aligned.");
		operation();
	}
	
}

function getFileDefaults() {
	let catInfo = {
		"categories": null,
		"categoryOptions": null,
		"categoryCombos": null,
		"categoryOptionCombos": null
	}

	for (let type in catInfo) {
		for (let obj of metadata[type]) {
			if (obj.name == "default") {
				catInfo[type] = obj.id;
				break;
			}			
		}
	}
	console.log("Defaults found in file:");
	console.log(catInfo);
	return catInfo;
}

async function getServerDefaults() {
	let catInfo = {
		"categories": null,
		"categoryOptions": null,
		"categoryCombos": null,
		"categoryOptionCombos": null
	}

	for (let type in catInfo) {

		let data = await d2Get(type + ".json?filter=name:eq:default", serverInfo);
		if (!data.hasOwnProperty(type) || data[type].length != 1) {
			console.log("Could not determine default " + type + " on server.");
			return false;
		}
		else catInfo[type] = data[type][0].id;

	}
	console.log("Defaults on server:");
	console.log(catInfo);
	return catInfo;
}


function setDefaultUid(fileDefaults, serverDefaults) {
	let edited = false;
	const types = ["categoryOptions", "categories", "categoryOptionCombos", "categoryCombos"];
	for (let type of types) {
		let currentDefault = fileDefaults[type];
		let serverDefault = serverDefaults[type];

		if (currentDefault != serverDefault) {
			console.log("Changing default " + type + " from " + currentDefault + " to " + serverDefault);
			
			edited = true;
			//search and replace metaData as text, to make sure customs forms, formulas etc are included
			var regex = new RegExp(currentDefault, "g");
			metadata = JSON.parse(JSON.stringify(metadata).replace(regex, serverDefault));
		}
	}

	return edited;
}


/** TRANSLATIONS */
async function translationSwap() {
	let stats = localeStats(metadata);
	let chosenLocale = await promptLocales(metadata, stats);
	
	let swappedMetadata = swapTranslations(metadata, chosenLocale.currentLocale, chosenLocale.newLocale);
	saveFile(swappedMetadata, saveFilePath(filePath(), chosenLocale.newLocale));
}

/** CLI */
async function promptLocales(metadata, stats) {
	var prompt = [
		{
			type: "list",
			name: "currentLocale",
			message: "Current main locale",
			choices: allLocaleOptions(),
			default: "en: English"
		},
		{
			type: "list",
			name: "newLocale",
			message: "Locale to set as main locale",
			choices: availableLocaleOptions(stats)
		}
	];
	let {currentLocale, newLocale} = await inquirer.prompt(prompt);
	return {
		"currentLocale": currentLocale.split(":")[0],
		"newLocale": newLocale.split(":")[0]
	}
}

/** METADATA OPERATIONS */
function swapTranslations(metadata, currentLocale, newLocale) {
	let property = {};
	for (let type in metadata) {
		for (let obj of metadata[type]) {
			if (obj.hasOwnProperty("translations")) {
				let newTranslations = [];
				for (let translation of obj.translations) {
					if (translation.locale == newLocale && obj.hasOwnProperty(propLookup(translation.property))) {
						let currentValue = obj[propLookup(translation.property)];
						let newValue = translation.value;

						//Tmp fix for short name translations > 50 characters
						if (translation.property == "SHORT_NAME") newValue = newValue.substring(0, 50);
						
						obj[propLookup(translation.property)] = newValue;
						translation.value = currentValue;
						translation.locale = currentLocale;

						newTranslations.push(translation);
					}
					else {
						newTranslations.push(translation);
					}
				}
				obj.translations = newTranslations;
			}
		}
	}
	return metadata;
}

function propLookup(translationProperty) {
	switch (translationProperty) {
		case "NAME":
			return "name";
		case "SHORT_NAME":
			return "shortName";
		case "DESCRIPTION":
			return "description";
		default:
			console.log("ERROR: unknown translatable property: " + translationProperty);
			return false;
	}
}


function localeStats(metadata) {
	let stats = {
		"otherObjects": 0,
		"translatableObjects": 0
	};
	for (let type in metadata) {
		for (let obj of metadata[type]) {
			if (obj.hasOwnProperty("translations")) {
				stats.translatableObjects++;
				let objLocales = {};
				for (let translation of obj.translations) {
					objLocales[translation.locale] = true; //translation (full or partial) exist for this object
				}
				for (let locale in objLocales) {
					if (!stats[locale]) {
						stats[locale] = 1;
					}
					else {
						stats[locale]++;
					}
				}
			}
			else {
				stats.otherObjects++;
			}
		}
	}
	return stats;
}


/** FILE OPERATIONS */
function filePath() {
	if (process.argv.length > 2) {
		var filePath = process.argv[2];
	}
	else {
		console.log("No metadata file specified. Use: node app.js metadata.json");
		return false;
	}
	if (fs.existsSync(filePath)) {
		return filePath;
	}
	else {
		console.log("The specified file does not exist.");
		return false;
	}
}

function saveFilePath(filePath, newLocale) {
	return filePath.replace(".json", "_" + newLocale + ".json");
}


function readFile(filePath) {
	let fileContent = fs.readFileSync(filePath);
	let metadata;
	try {
		metadata = JSON.parse(fileContent);
	} catch (error) {
		console.log("Problem parsing JSON:");
		console.log(error);
		return false;
	}
	return metadata;
}

function saveFile(metadata, filePath) {
	try {
		fs.writeFileSync(filePath, JSON.stringify(metadata, null, 4));
		console.log("Saved " + filePath);
	} catch (error) {
		console.log("Error saving swapped metadata file.");
		console.log(error);
	}
}


/** UTILITIES */
function allLocaleOptions() {
	let localeOptions = [];
	let all  = allLocales();
	for (let locale of all) {
		localeOptions.push(locale.locale + ": " + locale.name);
	}
	return localeOptions;
}


function availableLocaleOptions(localeStats) {
	var localeOptions = [];
	for (var localeKey in localeStats) {
		if (localeKey != "translatableObjects" && localeKey != "otherObjects") {
			let completeness = (100*localeStats[localeKey]/localeStats["translatableObjects"]).toFixed(1);
			localeOptions.push(localeKey + ": " + localeStats[localeKey] + " objects translated (" + completeness + "%)");
		}
	}
	return localeOptions;
}

function allLocales() {
	return [
	{
		"locale": "ar",
		"name": "Arabic"
	},
	{
		"locale": "ar_EG",
		"name": "Arabic (Egypt)"
	},
	{
		"locale": "ar_IQ",
		"name": "Arabic (Iraq)"
	},
	{
		"locale": "ar_SD",
		"name": "Arabic (Sudan)"
	},
	{
		"locale": "bn",
		"name": "Bengali"
	},
	{
		"locale": "bi",
		"name": "Bislama"
	},
	{
		"locale": "my",
		"name": "Burmese"
	},
	{
		"locale": "zh",
		"name": "Chinese"
	},
	{
		"locale": "da",
		"name": "Danish"
	},
	{
		"locale": "en",
		"name": "English"
	},
	{
		"locale": "fr",
		"name": "French"
	},
	{
		"locale": "in_ID",
		"name": "Indonesian (Indonesia)"
	},
	{
		"locale": "km",
		"name": "Khmer"
	},
	{
		"locale": "rw",
		"name": "Kinyarwanda"
	},
	{
		"locale": "lo",
		"name": "Lao"
	},
	{
		"locale": "mn",
		"name": "Mongolian"
	},
	{
		"locale": "ne",
		"name": "Nepali"
	},
	{
		"locale": "pt",
		"name": "Portuguese"
	},
	{
		"locale": "pt_BR",
		"name": "Portuguese (Brazil)"
	},
	{
		"locale": "ps",
		"name": "Pushto"
	},
	{
		"locale": "ru",
		"name": "Russian"
	},
	{
		"locale": "es",
		"name": "Spanish"
	},
	{
		"locale": "sv",
		"name": "Swedish"
	},
	{
		"locale": "tg",
		"name": "Tajik"
	},
	{
		"locale": "tet",
		"name": "Tetum"
	},
	{
		"locale": "ur",
		"name": "Urdu"
	},
	{
		"locale": "vi",
		"name": "Vietnamese"
	},
	{
		"locale": "ckb",
		"name": "ckb"
	},
	{
		"locale": "prs",
		"name": "prs"
	}
];
}


/** SERVER COMMUNICATION */
async function serverLogin() {
	let input = [
		{
			"type": "input",
			"name": "url",
			"message": "URL",
			"default": "https://play.dhis2.org/2.32"
		},
		{
			"type": "input",
			"name": "username",
			"message": "Username",
			"default": "admin"
		},
		{
			"type": "password",
			"name": "password",
			"message": "Password",
			"default": "district"
		}
	];

	let serverInfo = await inquirer.prompt(input);
	let success = await testConnection(serverInfo);
	if (success) return serverInfo;
	else return false;

}

async function testConnection(serverInfo) {
	try {
		let data = await d2Get("system/info.json", serverInfo);
		
		serverInfo.version = data.version;
		serverInfo.name = data.systemName;

		console.log("Connected to " + serverInfo.name + ", DHIS2 " + serverInfo.version);
		
		return true;
	} 
	catch (error) {
		if (JSON.stringify(error).indexOf("Bad credentials") > 0) {
			console.log("Wrong username/password")
		}
		else if (JSON.stringify(error).indexOf("Invalid URI") > 0) {
			console.log("Problem with URL - did you remember http/https?");
		}
		else if (JSON.stringify(error).indexOf("404 Not Found") > 0 ||
				JSON.stringify(error).indexOf("ECONNREFUSED") > 0) {
			console.log("Problem with URL - server not found or running.");
		}
		else {
			console.log(error);
		}
		return false;
	}
}

function d2Get(apiResource, serverInfo) {
	var deferred = Q.defer();

	var url = serverInfo.url + "/api/" + apiResource;
	if (url.indexOf("?") >= 0) url += "&paging=false";
	else url += "?paging=false";

	request.get({
		uri: url,
		json: true,
		auth: {
			"user": serverInfo.username,
			"pass": serverInfo.password
		}
	}, function (error, response, data) {
		if (!error && response.statusCode === 200) {
			deferred.resolve(data);
		}
		else {
			console.log("Error in GET");
			deferred.reject({'data': data, 'error': error, 'status': response});
		}
	});

	return deferred.promise;
}

function d2Post(apiResource, data, serverInfo) {
	var deferred = Q.defer();
	var url = serverInfo.url + "/api/" + apiResource;

	request.post({
		uri: url,
		json: true,
		body: data,
		auth: {
			"user": serverInfo.username,
			"pass": serverInfo.password
		}
	}, function (error, response, data) {
		if (!error && response.statusCode === 200) {
			deferred.resolve(data);
		}
		else {
			console.log("Error in POST");
			console.log(data);
			deferred.reject({"data": data, "error": error, "status": response.statusCode});
		}
	});

	return deferred.promise;
}

function d2Patch(apiResource, data, serverInfo) {
	var deferred = Q.defer();
	var url = serverInfo.url + "/api/" + apiResource;


	request.patch({
		uri: url,
		json: true,
		body: data,
		auth: {
			"user": serverInfo.username,
			"pass": serverInfo.password
		}
	}, function (error, response, data) {
		if (!error && response.statusCode.toString().charAt(0) == "2") {
			deferred.resolve(data);
		}
		else {
			console.log("Error in PATCH");
			console.log(data);
			deferred.reject({"data": data, "error": error, "status": response.statusCode});
		}
	});

	return deferred.promise;
}


/** UTILITIES */
function find(metadataArray, id) {
	for (let obj of metadataArray) {
		if (obj.id == id) return obj;
	}
	return false;
}

function primitive(toTest) {
    return (toTest !== Object(toTest));
}

function array(toTest) {
	return Array.isArray(toTest);
}