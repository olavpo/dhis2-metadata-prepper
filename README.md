# DHIS2 metadata file prepper
Tool for preparing a DHIS2 metadata file for import. Current functionality:
* replace identifiers of the "default" dimension (category, categoryOption, categoryCombo, categoryOptionCombo) in the metadata file with those on a server. 
* swap translations of a DHIS2 metadata file, swapping a language available as a translation with the main language.

## Installation
`npm install`

## Usage
To run the script: `node app.js metadata.json`

### Default
You will be asked to specify URL and credentials for the server (DHIS2 instance) the file will be imported into. The script will find the IDs of the default items on the server, and replace existing identifiers in the file with those on the server. 

The script will output a new file in the same location as the specified file, with the "newDefaults" included in the name (metadata.json => metadata_newDefaults.json).

### Translations
You will be asked to specify the current main language (e.g. English) and choose a locale for which translations are included in the file to set as the main language. The current main language will be included as translations (i.e. they are swapped).

The script will output a new file in the same location as the specified file, with the chosen locale included in the name (for example metadata.json => metadata_fr.json).
