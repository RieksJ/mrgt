import { saf } from "./Run.js";
import { log } from './Report.js';
import { MRG, TuC, Version } from './Interpreter.js';

import fs = require("fs");
import path = require('path');
import yaml = require('js-yaml');

export class Generator {
    public vsntag: string;

    public constructor({ vsntag }: { vsntag: string }) {
        this.vsntag = vsntag;
    }

    public initialize(): void {
        log.info('Initializing generator...');

        // Check if the vsntag exists in the SAF
        if (this.vsntag) {
            const vsn = saf.versions.find(vsn => vsn.vsntag === this.vsntag);
            if (vsn) {
                log.info(`\x1b[1;37mProcessing version '${vsn.vsntag}'...`);
                this.generate(vsn);
            } else {
                // check altvsntags
                const vsn = saf.versions.find(vsn => vsn.altvsntags.includes(this.vsntag));

                if (vsn) {
                    log.info(`\x1b[1;37mProcessing version '${vsn.vsntag}' (altvsn '${this.vsntag}')...`);
                    this.generate(vsn);
                } else {
                    // TODO Run onnotexist? Seems strange to do as there is no other vsntag to process
                    throw new Error(`The specified vsntag '${this.vsntag}' was not found in the SAF`);
                }
            }
        } else {
            // If no vsntag was specified, process all versions
            log.info(`No vsntag was specified. Processing all versions...`);
            saf.versions.forEach(vsn => {
                log.info(`\x1b[1;37mProcessing version '${vsn.vsntag}'...`);
                this.generate(vsn);
            });
        }

        // // iterate over TuC instances where synonymOfField is true
        // TuC.instances.forEach(tuc => {
        //     if (tuc.synonymOfField) {
        //         log.trace(`Handling synonymOf use in scope ${tuc.terminology.scopetag}`)
        //         // find the entries that have the synonymOf property set
        //         let entries = tuc.entries.filter(entry => entry.synonymOf);
        //         entries.forEach(entry => {
        //             // wrangle the synonymOf field using a regex
        //             let properties = entry.synonymOf!.match(/(?:(?<term>[a-z0-9_-]+))(?:(?:@(?:(?<scopetag>[a-z0-9_-]+)))?(?::(?<vsntag>[a-z0-9_-]+))?)/);
        //             if (properties?.groups) {
        //                 let mrgfile = `mrg.${properties.groups.scopetag ?? saf.scope.scopetag}.${properties.groups.vsntag ?? saf.scope.defaultvsn}.yaml`;
        //                 // if the mrgfile exists as a MRG.instance.filename, use that instance
        //                 let mrg = MRG.instances.find(mrg => mrg.filename === mrgfile) ?? new MRG({ filename: mrgfile });

        //                 // find the entry in the MRG
        //                 let entrymatch = mrg.entries.find(entry => entry.term === properties!.groups!.term);
        //                 if (entrymatch) {
        //                     // copy all entry's properties to the current entry
        //                     entry = Object.assign(entry, entrymatch);
        //                     // Output the MRG to a file
        //                     writeFile(path.join(saf.scope.localscopedir, saf.scope.glossarydir, mrgfile), yaml.dump(mrg, { forceQuotes: true }));  
        //                 } else {
        //                     log.warn(`\tEntry '${properties!.groups!.term}' not found in MRG '${mrgfile}'`);
        //                 }
        //             }
        //         });             
        //     }
        // });
    }

    public generate(vsn: Version): void {
        let tuc = new TuC({ instructions: vsn.termselcrit });
        let glossarydir = path.join(saf.scope.localscopedir, saf.scope.glossarydir);

        // set relevant fields in the terminology section
        tuc.terminology = {
            scopetag: saf.scope.scopetag,
            scopedir: saf.scope.scopedir,
            curatedir: saf.scope.curatedir,
            vsntag: vsn.vsntag,
            altvsntags: vsn.altvsntags
        };

        // set fields in the scopes section
        tuc.scopes.forEach(scope => {
            // find the corresponding scope in the SAF's scope section
            let SAFscope = saf.scopes.find(SAFscope => SAFscope.scopetag === scope.scopetag);
            if (SAFscope) {
                scope.scopedir = SAFscope.scopedir;
            } else {
                tuc.scopes.delete(scope);
            }
        });

        // create the MRG using terminology, scopes and entries and sort the entries by term
        let mrg = {
            terminology: tuc.terminology,
            scopes: Array.from(tuc.scopes),
            entries: tuc.entries.sort((a, b) => a.term.localeCompare(b.term))
        };

        // Output the MRG to a file
        let mrgFile = `mrg.${tuc.terminology.scopetag}.${tuc.terminology.vsntag}.yaml`;
        writeFile(path.join(glossarydir, mrgFile), yaml.dump(mrg, { forceQuotes: true }));

        // if the version is the default version, create a symbolic link
        if (saf.scope.defaultvsn === tuc.terminology.vsntag) {
            let defaultmrgFile = `mrg.${tuc.terminology.scopetag}.yaml`;
            let defaultmrgURL = path.join(glossarydir, defaultmrgFile);
            log.info(`\tCreating symlink for default version '${vsn.vsntag}'`);
            if (!fs.existsSync(defaultmrgURL)) {
                fs.symlinkSync(mrgFile, defaultmrgURL);
            } else {
                // overwrite existing symlink
                fs.unlinkSync(defaultmrgURL);
                fs.symlinkSync(mrgFile, defaultmrgURL);
            }
        }

        // Create a symlink for every altvsntag
        vsn.altvsntags.forEach(altvsntag => {
            let altmrgFile = `mrg.${tuc.terminology.scopetag}.${altvsntag}.yaml`;
            let altmrgURL = path.join(glossarydir, altmrgFile);
            log.info(`\tCreating symlink for altvsntag '${altvsntag}'`);
            if (!fs.existsSync(altmrgURL)) {
                fs.symlinkSync(mrgFile, altmrgURL);
            } else {
                // overwrite existing symlink
                fs.unlinkSync(altmrgURL);
                fs.symlinkSync(mrgFile, altmrgURL);
            }
        });
    }
}

/**
 * Creates directory tree and writes data to a file.
 * @param fullPath - The full file path.
 * @param data - The data to write.
 * @param force - Whether to overwrite existing files.
 */
export function writeFile(fullPath: string, data: string, force: boolean = true) {
    const dirPath = path.dirname(fullPath);
    const file = path.basename(fullPath);
    // Check if the directory path doesn't exist
    if (!fs.existsSync(dirPath)) {
        // Create the directory and any necessary parent directories recursively
        try {
            fs.mkdirSync(dirPath, { recursive: true });
        } catch (err) {
            log.error(`\tE007 Error creating directory '${dirPath}':`, err);
            return; // Stop further execution if directory creation failed
        }
    } else if (!force && fs.existsSync(path.join(dirPath, file))) {
        return; // Stop further execution if force is not enabled and file exists
    }

    try {
        fs.writeFileSync(path.join(dirPath, file), data);
    } catch (err) {
        log.error(`\tE008 Error writing file '${path.join(dirPath, file)}':`, err);
    }
}
