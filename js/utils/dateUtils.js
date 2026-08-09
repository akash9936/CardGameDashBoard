// Date utility functions for safe date handling across the application

// Utility function to safely format dates
function formatDate(dateValue) {
    if (!dateValue) return 'Unknown Date';
    
    try {
        let date;
        
        // Handle Firestore timestamp
        if (dateValue && typeof dateValue === 'object' && dateValue.toDate) {
            date = dateValue.toDate();
        } else {
            date = new Date(dateValue);
        }
        
        if (isNaN(date.getTime())) {
            return 'Invalid Date';
        }
        return date.toLocaleDateString();
    } catch (error) {
        console.warn('Error formatting date:', dateValue, error);
        return 'Invalid Date';
    }
}

// Utility function to safely format date and time
function formatDateTime(dateValue) {
    if (!dateValue) return 'Unknown Date';
    
    try {
        let date;
        
        // Handle Firestore timestamp
        if (dateValue && typeof dateValue === 'object' && dateValue.toDate) {
            date = dateValue.toDate();
        } else {
            date = new Date(dateValue);
        }
        
        if (isNaN(date.getTime())) {
            return 'Invalid Date';
        }
        return date.toLocaleString();
    } catch (error) {
        console.warn('Error formatting date/time:', dateValue, error);
        return 'Invalid Date';
    }
}

// Utility function to safely create Date objects
function safeDate(dateValue) {
    if (!dateValue) return new Date();
    
    try {
        let date;
        
        // Handle Firestore timestamp
        if (dateValue && typeof dateValue === 'object' && dateValue.toDate) {
            date = dateValue.toDate();
        } else {
            date = new Date(dateValue);
        }
        
        if (isNaN(date.getTime())) {
            console.warn('Invalid date value:', dateValue, 'using current date');
            return new Date();
        }
        return date;
    } catch (error) {
        console.warn('Error creating date from:', dateValue, error);
        return new Date();
    }
}

// Export functions to global scope for use in other modules
window.DateUtils = {
    formatDate,
    formatDateTime,
    safeDate
}; 