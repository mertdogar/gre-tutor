#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const colors = require('colors');
const prompt = require('prompt');
const promptAuto = require('prompt-autocomplete');
const homedir = require('homedir')();
const argv = require('minimist')(process.argv.slice(2));
const dictionaryPath = argv.open || argv.o || path.join(homedir, '.words.json');
const persistenceFile = path.resolve(process.cwd(), dictionaryPath);
const desiredCoverage = argv.coverage || argv.c || 90;
const mute = argv.mute || argv.m;


try { fs.accessSync(persistenceFile, fs.F_OK); }
catch (err) {
    if (err.code != 'ENOENT') return console.log(err);
    fs.writeFileSync(persistenceFile, JSON.stringify({}, null, 4));
}

const words = require(persistenceFile);

process.on('uncaughtException', gracefulExit);
process.on('SIGTERM', gracefulExit);
process.on('SIGINT', gracefulExit);


const defaultWeek = _.chain(words)
    .keys()
    .map(weekName => parseInt(weekName.slice(4), 10))
    .sort()
    .reverse()
    .head()
    .value();

const prepWeek = parseInt(argv.w || argv.week || defaultWeek || 1, 10);
const wordList = _.merge(... _.cloneDeep(_.valuesIn(words)));
const checklist = _.chain(words)
    .pickBy((_, weekName) => parseInt(weekName.slice(4), 10) <= prepWeek)
    .flatMap(week => Object.keys(week))
    .keyBy()
    .mapValues(_ => false)
    .value();


console.log('Welcome to GRE - Tutor'.black);
console.log('It appears we are working on ' + 'week '.red + prepWeek.toString().red);


if (argv.help || argv.h) return showHelp();
if (argv.add || argv.a) return addWords();
if (argv.backup || argv.b) return save(path.resolve(argv.backup || argv.b));
if (argv.restore || argv.r) return restoreSave(path.resolve(argv.restore || argv.r));
if (argv.train || argv.t) return train().then(() => {
    console.log('Congratulations, you have trained on ' + _.filter(checklist).length.toString().red + ' different words');
    pronounce('Congratulations, you have trained on ' + _.filter(checklist).length.toString() + ' different words');
});
if (argv.search || argv.s) return search();
return console.log(`There are ${_.keys(checklist).length} words in dictionary. They are:\n`, words);


/**
 * INSERTION LOGIC
 */

function addWords() {
    const insertWordLoop = _ => insertWord().then(_ => insertWordLoop());
    return insertWordLoop().catch(gracefulExit);
}


function insertWord() {
    let speechFinished;

    return new Promise((resolve, reject) => {
        if (!words[`week${prepWeek}`]) words[`week${prepWeek}`] = {};

        const wordCount = Object.keys(words[`week${prepWeek}`]).length;
        const wordVar = `word #${wordCount + 1} of week${prepWeek}`;

        prompt.get(wordVar, (err, response) => {
            if (err) return reject(err);
            const word = response[wordVar];

            speechFinished = pronounce(word);

            prompt.get('meaning', (err, response) => {
                if (err) return reject(err);

                words[`week${prepWeek}`][word] = response.meaning;
                resolve();
            });
        });
    })
    .then(_ => speechFinished);
}


/**
 * TRAINING LOGIC
 */


function train() {
    const askLoop = _ => askAWord().then(_ => coverage() >= desiredCoverage ? Promise.resolve : askLoop());
    return askLoop().catch(gracefulExit);
}


function coverage({inclusive = 0} = {}) {
    return 100 * (_.filter(checklist).length + inclusive) / _.keys(checklist).length;
}

function askAWord() {
    let speechFinished;

    return new Promise((resolve, reject) => {
        const {word, meaning} = getRandomWord();
        speechFinished = pronounce(word);

        const covered = coverage({inclusive: 1});
        const wordQuestion = `${word.blue} %${covered.toFixed(0)}`;

        prompt.get(wordQuestion, (err, response) => {
            if (err) return reject(err);

            if (response[wordQuestion] == meaning ||
                response[wordQuestion] == '' ||
                response[wordQuestion].toLowerCase() == 'y' ||
                response[wordQuestion].toLowerCase() == 'yes') {
                checklist[word] = true;
                console.log('Correct. It\'s: '.black + meaning.red);
                resolve();
            }
            else if (response[wordQuestion] == '?') {
                console.log('It means '.black + meaning.red);

                const question = 'Did you know it?'.magenta;

                prompt.get(question, (err, response) => {
                    if (err) return reject(err);

                    if (response[question] == '' ||
                        response[question].toLowerCase() == 'y' ||
                        response[question].toLowerCase() == 'yes') {
                        checklist[word] = true;
                        console.log('Perfect!'.grey);
                        resolve();
                    }
                    else {
                        console.log('OK, we\'ll come back to this one later...'.grey);
                        resolve();
                    };

                });
            } else {
                console.log('NOPE! '.black + 'It means '.grey + meaning.red);
                resolve();
            };
        });
    })
    .then(_ => speechFinished);
}


function getRandomWord() {
    const word = _.chain(wordList)
        .keys()
        .filter(word => !checklist[word])
        .sample()
        .value();

    const meaning = wordList[word];

    const weekOfTheWord = parseInt(_.findKey(words, week => _.keys(week).includes(word)).slice(4), 10);
    const gaussian = gaussianGenerator(1, 1, (prepWeek - 1) || 0.01);
    const p_selectingWeek = gaussian(weekOfTheWord);

    if (Math.random() < p_selectingWeek) return {word, meaning};
    return getRandomWord();
}


function gaussianGenerator(peakValue, peakPosition, peakWidth) {
    return function(x) {
        const deviation = ((x - peakPosition) * (x - peakPosition)) / (2 * peakWidth * peakWidth);
        return peakValue * Math.exp(-1 * deviation);
    }
}

/**
 * SEARCH LOGIC
 */

function search() {
    const searchLoop = _ => searchAWord().then(_ => searchLoop());
    return searchLoop().catch(gracefulExit);
}


function searchAWord() {
    return new Promise((resolve, reject) => {
        promptAuto('Word:', Object.keys(wordList), (err, word) => {
            if (err) return reject(err);
            console.log(word.blue + ' => '.black + wordList[word].red);
            resolve(word);
        });
    })
    .then(pronounce)
    .then(_ => {
        return new Promise((resolve, reject) => {
            const listener = _ => {
                process.stdin.removeListener('data', listener);
                resolve();
            };

            process.stdin.resume();
            process.stdin.on('data', listener);
        });
    });
}


/**
 * PERSISTENCE LOGIC
 */

function save(path = persistenceFile) {
    fs.writeFileSync(path, JSON.stringify(words, null, 4));
    console.log('All changes are saved to '.green + path.black);
}


function gracefulExit(e) {
    console.log(e.black);
    save();
    process.exit();
}


/**
 * RESTORE LOGIC
 */

function restoreSave(path) {
    if (!_.isString(path)) return console.log('You must type a valid backup file path');

    const restoredWords = require(path);
    fs.writeFileSync(persistenceFile, JSON.stringify(restoredWords, null, 4));

    console.log('Dictionary is replaced with the file at '.green + path.black);
    process.exit();
}


function pronounce(word, voice = argv.v || argv.voice || 'Samantha') {
    if (mute) return Promise.resolve();
    if (process.platform !== 'darwin') return Promise.resolve();

    return new Promise((resolve, reject) => {
        require('child_process').exec(`say ${word} -v ${voice}`, err => {
            if (err) return reject(err);
            resolve();
        });
    });
}


/**
 * HELP
 */

function showHelp() {
    console.log(`
/*****************************************************
GRE - Vocabulary Tutor
Version: ${require('./package.json').version.grey}
*****************************************************/

How to Train?

- Start the tutor with '-t' option
- Tutor will ask a word
- If you know the meaning of the word, just press 'Enter' (or type the meaning of the word as it is in dictionary)
- If you do not know the meaning, type anything and press 'Enter'.
- If you'd like to see the meaning before deciding, you can peek at the answer. Type '?' and press Enter
- Repeat until desired coverage (%) is reached


Usage:

* ${'gre-tutor [--open | -o <filepath>]'.blue} : Lists all the words in the opened dictionary
* ${'gre-tutor (--help | -h)'.blue} : Show this help page
* ${'gre-tutor (--add | -a) [--week | -w <weeknumber>] [--voice | -v <voicename>] [--mute | -m] [--open | -o <filepath>]'.blue} : Insert words to the dictionary
* ${'gre-tutor (--train | -t) [--week | -w <weeknumber>] [--voice | -v <voicename>] [--mute | -m] [--coverage | -c <percentage>] [--open | -o <filepath>]'.blue} : Train on the words in the dictionary
* ${'gre-tutor (--search | -s) [--voice | -v <voicename>] [--mute | -m] [--open | -o <filepath>]'.blue} : Search words in the dictionary
* ${'gre-tutor (--backup | -b) <filepath> [--open | -o <filepath>]'.blue} : Create a copy of the currently open dictionary at the desired filepath
* ${'gre-tutor (--restore | -r) <filepath>'.blue} : Overwrite the default dictionary with the dictionary at the filepath


Notes:

${'--open | -o <filepath>'.cyan} : Default is '~/.words.json'. This parameter changes the load/save path of the dictionary only for this run.
${'--week | -w <number>'.cyan} : Default is the last week. This parameter serves 2 purposes
    1. When inserting words, it inserts into the appropriate week
    2. When training words, it adjusts the probability of a word coming up, depending on its week
${'--voice | -v <voiceName>'.cyan} : Default is Samantha. Change the voice of the pronounciation. For the list of available voices, you may type 'say -v ?' in your terminal or may refer to apple docs.
${'--mute | -m'.cyan} : Type this option if hearing the pronunciation annoys you.
${'--coverage | -c <number>'.cyan} : Default is 90. Set a desired coverage amount for training. For example, if you set it 50, your training will be completed after covering 50% of the words in the dictionary.


Examples:

${'$ gre-tutor'.magenta} -> List all words in default dictionary
${'$ gre-tutor --open myDict.json --add'.magenta} -> Add words to the last week of dictionary at myDict.json
${'$ gre-tutor -a -w 3'.magenta} -> Add words to the 3rd week of the default dictionary
${'$ gre-tutor -t -v Alex -c 75'.magenta} -> Train on the default dictionary with 75% coverage. Use Alex voice as pronunciation
${'$ gre-tutor --search -m -o myDict.json'.magenta} -> Browse words in myDict.json dictionary and mute the voice while browsing
${'$ gre-tutor --backup backup.json --open myDict.json'.magenta} -> Create a backup of myDict.json at backup.json
${'$ gre-tutor --restore backup.json'.magenta} -> Overwrite the default dictionary with the contents of backup.json
`);
}
