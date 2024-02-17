import { DependencyContainer } from "tsyringe";
import { Ilogger } from "@spt-aki/models/spt/utils/Ilogger";
import { IPostDBLoadMod } from "@spt-aki/models/external/IPostDBLoadMod";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { ILocationData } from "@spt-aki/models/spt/server/ILocations";

//item creation
import { CustomItemService } from "@spt-aki/services/mod/CustomItemService";
import { NewItemFromCloneDetails } from "@spt-aki/models/spt/mod/NewItemDetails";

import * as path from "path";
const fs = require('fs');
const modPath = path.normalize(path.join(__dirname, '..'));


class StimsGalore implements IPostDBLoadMod
{
	private logger: Ilogger;
	public mod: string;
    public modShortName: string;

	constructor() {
        this.mod = "MusicManiac-Stims-Galore";
        this.modShortName = "Stims Galore";
    }

	public postDBLoad ( container: DependencyContainer ): void 
	{
		// Get the logger from the server container.
		this.logger = container.resolve<Ilogger>("WinstonLogger");
		const logger = this.logger;
		logger.info(`[${this.modShortName}] ${this.mod} started loading`);
		// Get database from server.
		const db = container.resolve<DatabaseServer>( "DatabaseServer" );

		//Custom item server to create new items.
		const customItem = container.resolve<CustomItemService>( "CustomItemService" );


		// Get tables from database
		let tables = db.getTables();
		// Get item database from tables
		const itemDB = tables.templates.items;
		const handbook = tables.templates.handbook;
		const fleaPriceTable = tables.templates.prices;
		const quests = tables.templates.quests;
		const traders = tables.traders;
		const production = tables.hideout.production;
		const staticLoot = tables.loot.staticLoot;

		

		const modShortName = this.modShortName;

		function traverse(dir: string): void {
            const files = fs.readdirSync(dir);
            files.forEach((file) => {
                const filePath = path.join(dir, file);
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                    traverse(filePath);
                } else if (path.extname(filePath).toLowerCase() === '.json') {
					console.log(`[${modShortName}] Processing file:`, filePath);
					const fileContent = fs.readFileSync(filePath, 'utf-8');
                    const stimFile = JSON.parse(fileContent);
					
					const originalStim = stimFile.cloneOrigin;
					const handbookEntry = handbook.Items.find(item => item.Id === originalStim);
					const handbookParentId = handbookEntry ? handbookEntry.ParentId : undefined;
					const newStimId = stimFile.id;

					let fleaPrice: number;
					if (stimFile.fleaPrice === "asOriginal") {
						fleaPrice = fleaPriceTable[originalStim];
					} else if (stimFile.fleaPrice <= 10) {
						fleaPrice = fleaPriceTable[originalStim] * stimFile.fleaPrice;
					} else {
						fleaPrice = stimFile.fleaPrice;
					}

					let handbookPrice: number;
					if (stimFile.handBookPrice === "asOriginal") {
						handbookPrice = handbook.Items.find(item => item.Id === originalStim)?.Price;
					} else if (stimFile.handBookPrice <= 10) {
						handbookPrice = fleaPriceTable[originalStim] * stimFile.handBookPrice;
					} else {
						handbookPrice = stimFile.handBookPrice;
					}

					const stimClone: NewItemFromCloneDetails = {
						itemTplToClone: originalStim,
						overrideProperties: {
							StimulatorBuffs: newStimId
						},
						newId: newStimId,
						parentId: itemDB[originalStim]._parent,
						handbookParentId: handbookParentId,
						fleaPriceRoubles: fleaPrice,
						handbookPriceRoubles: handbookPrice,
						locales: stimFile.locales
					}
					customItem.createItemFromClone(stimClone);

					tables.globals.config.Health.Effects.Stimulator.Buffs[newStimId] = stimFile.Buffs;

					// Add to quests
					if (stimFile.includeInSameQuestsAsOrigin) {
						for (const quest of Object.keys(quests)) {
							const questContent = quests[quest];
							for (const nextCondition of questContent.conditions.AvailableForFinish) {
								let nextConditionData = nextCondition;
								if ((nextConditionData._parent == "HandoverItem" || nextConditionData._parent == "FindItem") && nextConditionData._props.target.includes(originalStim)) {
									logger.info(`[${modShortName}] found ${originalStim} as find/handover item in quest ${questContent._id} aka ${questContent.QuestName}, adding ${newStimId} to it`);
									nextConditionData._props.target.push(newStimId);
								}
							}
						}
					}
					
					// Add spawn points
					// Big thanks to RainbowPC and his Lots Of Loot (https://hub.sp-tarkov.com/files/file/697-lots-of-loot/) as this function is direct steal from there 
					if (stimFile.addSpawnsInSamePlacesAsOrigin) {
						const lootComposedKey = newStimId +"_composedkey"
						const maps = ["bigmap", "woods", "factory4_day", "factory4_night", "interchange", "laboratory", "lighthouse", "rezervbase", "shoreline", "tarkovstreets"];
						for (const [name, temp] of Object.entries(tables.locations)) {
							const mapdata : ILocationData = temp;
							for (const Map of maps) {
								if (name === Map) {
									for (const point of mapdata.looseLoot.spawnpoints) {
										for (const itm of point.template.Items) {
											if (itm._tpl == originalStim) {
												const originalItemID = itm._id;
												let originRelativeProb: any;
												for (const dist of point.itemDistribution) {
													if (dist.composedKey.key == originalItemID) {
														originRelativeProb = dist.relativeProbability;
														point.template.Items.push({
															_id: lootComposedKey,
                        									_tpl: newStimId
														})
													}
												}
												point.itemDistribution.push({
													composedKey: {
														key: lootComposedKey
													},
													relativeProbability: Math.max(Math.round(originRelativeProb * stimFile.spawnWeightComparedToOrigin), 1)
												})
											}
										}
									}
								}
							}
						}

						for (const container in staticLoot) {
							const originIndex = staticLoot[container].itemDistribution.findIndex(entry => entry.tpl === originalStim);
							if (originIndex !== -1) {
								const originProbability = staticLoot[container].itemDistribution[originIndex].relativeProbability
								const spawnRelativeProbability = Math.max(Math.round(originProbability * stimFile.spawnWeightComparedToOrigin), 1);
								//logger.warning(`[${modShortName}] didn't find existing entry for ${newStimId} in container ${container} items distribution`);
								staticLoot[container].itemDistribution.push({
									tpl: newStimId,
									relativeProbability: spawnRelativeProbability
								})
								//const lastElement = staticLoot[container].itemDistribution[staticLoot[container].itemDistribution.length - 1];
								//logger.warning(`[${modShortName}] pushed element: ${JSON.stringify(lastElement)}`);
							}
						}
					}

					// add to traders
					if (stimFile.hasOwnProperty("trader")) {
						const trader = traders[stimFile.trader.traderId];
						trader.assort.items.push({
							"_id": newStimId,
							"_tpl": newStimId,
							"parentId": "hideout",
							"slotId": "hideout",
							"upd":
							{
								"UnlimitedCount": false,
								"StackObjectsCount": stimFile.trader.amountForSale
							}
						});
						trader.assort.barter_scheme[newStimId] = [
							[
								{
									"count": stimFile.trader.price,
									"_tpl": "5449016a4bdc2d6f028b456f" // roubles
								}
							]
						];
						trader.assort.loyal_level_items[newStimId] = stimFile.trader.loyaltyReq;
					}

					// add craft
					if (stimFile.hasOwnProperty("craft")) {
						production.push(stimFile.craft);
					}
                }
            });
        }
        traverse(`${modPath}/stims/`);
		logger.success(`[${this.modShortName}] ${this.mod} finished loading`);
	}
}

module.exports = { mod: new StimsGalore() }