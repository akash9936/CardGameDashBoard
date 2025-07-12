class FirebaseService {
  constructor() {
    this.db = firebase.firestore();
  }

  // Helper method to ensure ID is a string
  _ensureStringId(id) {
    if (id === null || id === undefined) {
      throw new Error('Document ID cannot be null or undefined');
    }
    return String(id);
  }

  // Core CRUD operations
  async createTeam(teamData) { 
    try {
      const docRef = await this.db.collection("teams").add(teamData);
      return docRef.id;
    } catch (error) {
      console.error('Error creating team:', error);
      throw error;
    }
  }

  async updateTeam(teamId, updates) { 
    try {
      const stringId = this._ensureStringId(teamId);
      await this.db.collection("teams").doc(stringId).update(updates);
    } catch (error) {
      console.error('Error updating team:', error);
      throw error;
    }
  }

  async getTeam(teamId) { 
    try {
      const stringId = this._ensureStringId(teamId);
      const doc = await this.db.collection("teams").doc(stringId).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (error) {
      console.error('Error getting team:', error);
      throw error;
    }
  }

  async getAllTeams() { 
    try {
      const snapshot = await this.db.collection("teams").get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error getting all teams:', error);
      throw error;
    }
  }
  
  async createMatch(matchData) { 
    try {
      const docRef = await this.db.collection("matches").add(matchData);
      return docRef.id;
    } catch (error) {
      console.error('Error creating match:', error);
      throw error;
    }
  }

  async updateMatch(matchId, updates) { 
    try {
      const stringId = this._ensureStringId(matchId);
      await this.db.collection("matches").doc(stringId).update(updates);
    } catch (error) {
      console.error('Error updating match:', error);
      throw error;
    }
  }

  async getMatch(matchId) { 
    try {
      const stringId = this._ensureStringId(matchId);
      const doc = await this.db.collection("matches").doc(stringId).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (error) {
      console.error('Error getting match:', error);
      throw error;
    }
   }

  async getAllMatches() { 
    try {
      const snapshot = await this.db.collection("matches").get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error getting all matches:', error);
      throw error;
    }
  }

  // Real-time listeners
  subscribeToTeams(callback) { 
    return this.db.collection("teams").onSnapshot(snapshot => {
      const teams = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      callback(teams);
    }, error => {
      console.error('Error in teams subscription:', error);
    });
  }

  subscribeToMatches(callback) { 
    return this.db.collection("matches").onSnapshot(snapshot => {
      const matches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      callback(matches);
    }, error => {
      console.error('Error in matches subscription:', error);
    });
  }
  
  // Migration utilities
  async migrateFromLocalStorage(data) { 
    try {
      const batch = this.db.batch();

      data.teams.forEach(team => {
        const teamRef = this.db.collection("teams").doc(this._ensureStringId(team.id));
        batch.set(teamRef, team);
      });

      data.matches.forEach(match => {
        const matchRef = this.db.collection("matches").doc(this._ensureStringId(match.id));
        batch.set(matchRef, match);
      });

      await batch.commit();
      console.log('Migration completed successfully');
    } catch (error) {
      console.error('Error during migration:', error);
      throw error;
    }
  }

  async validateDataIntegrity() { 
    try {
      const teams = await this.getAllTeams();
      const matches = await this.getAllMatches();
      
      console.log(`Data integrity check: ${teams.length} teams, ${matches.length} matches`);
      return { teams: teams.length, matches: matches.length };
    } catch (error) {
      console.error('Error validating data integrity:', error);
      throw error;
    }
  }
}
