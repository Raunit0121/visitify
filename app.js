class VisitorCheckInApp {
    constructor() {
        this.currentScreen = 'welcome-screen';
        this.qrScanner = null;
        this.currentInvitation = null;
        this.init();
    }

    init() {
        this.bindEvents();
        this.showScreen('welcome-screen');
    }

    bindEvents() {
        // Navigation events
        document.getElementById('start-scan-btn').addEventListener('click', () => {
            this.startQRScanner();
        });

        document.getElementById('back-to-welcome').addEventListener('click', () => {
            this.stopQRScanner();
            this.showScreen('welcome-screen');
        });

        document.getElementById('new-registration').addEventListener('click', () => {
            this.resetApp();
        });

        document.getElementById('retry-registration').addEventListener('click', () => {
            this.showScreen('registration-screen');
        });

        document.getElementById('back-to-start').addEventListener('click', () => {
            this.resetApp();
        });

        // Form events
        document.getElementById('registration-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitRegistration();
        });

        document.getElementById('visitor-photo').addEventListener('change', (e) => {
            this.handlePhotoUpload(e);
        });

        document.getElementById('remove-photo').addEventListener('click', () => {
            this.removePhoto();
        });

        // Toast events
        document.getElementById('toast-close').addEventListener('click', () => {
            this.hideToast();
        });
    }

    showScreen(screenId) {
        // Hide all screens
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });

        // Show target screen
        document.getElementById(screenId).classList.add('active');
        this.currentScreen = screenId;
    }

    async startQRScanner() {
        this.showScreen('scanner-screen');
        
        try {
            this.qrScanner = new Html5Qrcode("qr-reader");
            
            const config = {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0
            };

            await this.qrScanner.start(
                { facingMode: "environment" },
                config,
                (decodedText, decodedResult) => {
                    this.handleQRScanSuccess(decodedText);
                },
                (errorMessage) => {
                    // Handle scan errors silently
                }
            );
        } catch (err) {
            console.error('Error starting QR scanner:', err);
            this.showError('Failed to start camera. Please check permissions.');
        }
    }

    async stopQRScanner() {
        if (this.qrScanner) {
            try {
                await this.qrScanner.stop();
                this.qrScanner = null;
            } catch (err) {
                console.error('Error stopping QR scanner:', err);
            }
        }
    }

    async handleQRScanSuccess(qrData) {
        document.getElementById('scanner-loading').style.display = 'flex';
        
        try {
            await this.stopQRScanner();
            
            // Parse QR data
            const parsedData = this.parseQRData(qrData);
            if (!parsedData) {
                throw new Error('Invalid QR code format');
            }

            const invitationId = parsedData.invitation_id;
            if (!invitationId) {
                throw new Error('Invalid invitation ID');
            }

            // Get invitation from Firestore
            const invitation = await this.getInvitation(invitationId);
            if (!invitation) {
                throw new Error('Invitation not found');
            }

            if (!this.isInvitationValid(invitation)) {
                throw new Error('This invitation has expired or is no longer valid');
            }

            this.currentInvitation = invitation;
            this.populateInvitationInfo(invitation);
            this.showScreen('registration-screen');

        } catch (error) {
            console.error('QR scan error:', error);
            this.showError(error.message);
            document.getElementById('scanner-loading').style.display = 'none';
        }
    }

    parseQRData(qrData) {
        try {
            const data = JSON.parse(qrData);
            if (data.type === 'visitor_invitation') {
                return data;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    async getInvitation(invitationId) {
        try {
            const doc = await db.collection('qr_invitations').doc(invitationId).get();
            if (doc.exists) {
                return { id: doc.id, ...doc.data() };
            }
            return null;
        } catch (error) {
            console.error('Error getting invitation:', error);
            return null;
        }
    }

    isInvitationValid(invitation) {
        const now = new Date();
        const validFrom = invitation.valid_from.toDate();
        const validUntil = invitation.valid_until.toDate();
        
        return invitation.is_active &&
               now >= validFrom &&
               now <= validUntil &&
               invitation.used_count < invitation.max_visitors;
    }

    populateInvitationInfo(invitation) {
        const infoContainer = document.getElementById('invitation-info');
        infoContainer.innerHTML = `
            <h4>✅ Valid Invitation</h4>
            <p><strong>Host:</strong> ${invitation.host_name}</p>
            <p><strong>Flat:</strong> ${invitation.flat_no}</p>
            <p><strong>Purpose:</strong> ${invitation.purpose}</p>
            <p><strong>Valid Until:</strong> ${this.formatDateTime(invitation.valid_until.toDate())}</p>
            ${invitation.notes ? `<p><strong>Notes:</strong> ${invitation.notes}</p>` : ''}
        `;
    }

    async submitRegistration() {
        const submitBtn = document.getElementById('submit-registration');
        const btnText = submitBtn.querySelector('.btn-text');
        const btnLoading = submitBtn.querySelector('.btn-loading');
        
        submitBtn.disabled = true;
        btnText.style.display = 'none';
        btnLoading.style.display = 'flex';

        try {
            const formData = new FormData(document.getElementById('registration-form'));
            
            // Validate required fields
            const name = formData.get('name').trim();
            const phone = formData.get('phone').trim();
            
            if (!name) {
                throw new Error('Please enter visitor name');
            }

            // Use the QR invitation first
            const invitationUsed = await this.useInvitation(this.currentInvitation.id);
            if (!invitationUsed) {
                throw new Error('Failed to validate invitation');
            }

            // Create visitor record with same structure as guard scanner
            const visitorId = this.generateUUID();
            const visitorData = {
                id: visitorId,
                name: name,
                visiting_flat: this.currentInvitation.flat_no,
                phone: phone || '',
                photo_url: this.currentInvitation.image_url || null,
                status: 'checked_in', // Auto check-in like guard scanner
                entry_time: firebase.firestore.Timestamp.now(),
                check_in_time: firebase.firestore.Timestamp.now(),
                purpose: this.currentInvitation.purpose,
                qr_code: this.currentInvitation.id,
                host_id: this.currentInvitation.host_id,
                host_name: this.currentInvitation.host_name,
                is_pre_approved: true, // QR visitors are pre-approved
                valid_until: null,
                email: formData.get('email') || null,
                company: formData.get('company') || null
            };

            // Save visitor to Firestore with specific ID
            await db.collection('visitors').doc(visitorId).set(visitorData);
            
            // Send notifications
            await this.sendNotifications(visitorData, visitorId);

            // Show success
            this.showSuccess(visitorData);

        } catch (error) {
            console.error('Registration error:', error);
            this.showError(error.message);
        } finally {
            submitBtn.disabled = false;
            btnText.style.display = 'inline';
            btnLoading.style.display = 'none';
        }
    }

    async useInvitation(invitationId) {
        try {
            const invitationRef = db.collection('qr_invitations').doc(invitationId);
            
            return await db.runTransaction(async (transaction) => {
                const doc = await transaction.get(invitationRef);
                
                if (!doc.exists) {
                    throw new Error('Invitation not found');
                }

                const invitation = doc.data();
                
                if (!this.isInvitationValid({ ...invitation, id: doc.id })) {
                    throw new Error('Invitation is not valid');
                }

                // Increment used count
                transaction.update(invitationRef, {
                    used_count: invitation.used_count + 1
                });

                return true;
            });
        } catch (error) {
            console.error('Error using invitation:', error);
            return false;
        }
    }

    async sendNotifications(visitorData, visitorId) {
        try {
            // Create notification for guard - visitor logged successfully
            const guardNotification = {
                type: 'visitor_logged',
                title: 'Visitor Logged Successfully',
                message: `${visitorData.name} has been logged and checked in to visit ${visitorData.visiting_flat}`,
                visitor_id: visitorId,
                visitor_name: visitorData.name,
                flat_no: visitorData.visiting_flat,
                host_name: visitorData.host_name,
                purpose: visitorData.purpose,
                timestamp: firebase.firestore.Timestamp.now(),
                read: false,
                target_role: 'guard'
            };

            // Create notification for resident/host - visitor has arrived
            const residentNotification = {
                type: 'visitor_checked_in',
                title: 'Visitor Checked In',
                message: `${visitorData.name} has checked in and is on their way to visit you`,
                visitor_id: visitorId,
                visitor_name: visitorData.name,
                visitor_phone: visitorData.phone,
                purpose: visitorData.purpose,
                timestamp: firebase.firestore.Timestamp.now(),
                read: false,
                target_user_id: visitorData.host_id
            };

            // Save notifications to Firestore
            await Promise.all([
                db.collection('notifications').add(guardNotification),
                db.collection('notifications').add(residentNotification)
            ]);

            console.log('Notifications sent successfully');
        } catch (error) {
            console.error('Error sending notifications:', error);
            // Don't throw error as registration was successful
        }
    }

    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    showSuccess(visitorData) {
        const successDetails = document.getElementById('success-details');
        successDetails.innerHTML = `
            <p><strong>Name:</strong> ${visitorData.name}</p>
            <p><strong>Visiting:</strong> ${visitorData.visiting_flat}</p>
            <p><strong>Host:</strong> ${visitorData.host_name}</p>
            <p><strong>Time:</strong> ${this.formatDateTime(new Date())}</p>
            <p><strong>Status:</strong> <span style="color: #1976D2; font-weight: bold;">Checked In</span></p>
            <p style="color: #1976D2; font-weight: bold; margin-top: 1rem;">
                You have been successfully checked in! The guard and host have been notified.
            </p>
        `;
        this.showScreen('success-screen');
        this.showToast('Visitor logged successfully! You are now checked in.', 'success');
    }

    showError(message) {
        document.getElementById('error-message').textContent = message;
        this.showScreen('error-screen');
        this.showToast(message, 'error');
    }

    showToast(message, type = 'info') {
        const toast = document.getElementById('notification-toast');
        const toastMessage = document.getElementById('toast-message');
        
        toastMessage.textContent = message;
        toast.className = `toast ${type}`;
        toast.classList.add('show');

        // Auto hide after 5 seconds
        setTimeout(() => {
            this.hideToast();
        }, 5000);
    }

    hideToast() {
        document.getElementById('notification-toast').classList.remove('show');
    }

    handlePhotoUpload(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const preview = document.getElementById('photo-preview');
                const previewImage = document.getElementById('preview-image');
                
                previewImage.src = e.target.result;
                preview.style.display = 'block';
            };
            reader.readAsDataURL(file);
        }
    }

    removePhoto() {
        document.getElementById('visitor-photo').value = '';
        document.getElementById('photo-preview').style.display = 'none';
    }

    resetApp() {
        this.currentInvitation = null;
        document.getElementById('registration-form').reset();
        document.getElementById('photo-preview').style.display = 'none';
        this.showScreen('welcome-screen');
    }

    formatDateTime(date) {
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new VisitorCheckInApp();
});