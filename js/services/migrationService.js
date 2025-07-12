
class MigrationService {
    constructor(storage, firebaseService) {
        this.storage = storage;
        this.firebaseService = firebaseService;
    }

    async migrateData() {
        console.log('Starting data migration from localStorage to Firestore...');

        try {
            const data = this.exportDataFromLocalStorage();
            if (!data.teams.length && !data.matches.length) {
                console.log('No data to migrate.');
                return;
            }

            console.log(`Found ${data.teams.length} teams and ${data.matches.length} matches to migrate.`);

            await this.uploadDataToFirestore(data);

            console.log('Data migration completed successfully.');
        } catch (error) {
            console.error('Data migration failed:', error);
        }
    }

    exportDataFromLocalStorage() {
        const teams = this.storage.getAllTeams().map(team => team.toJSON());
        const matches = this.storage.getAllMatches().map(match => match.toJSON());
        return { teams, matches };
    }

    async uploadDataToFirestore(data) {
        await this.firebaseService.migrateFromLocalStorage(data);
    }
}
