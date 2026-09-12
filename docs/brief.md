Build a small, simple telehealth app that allows a patient to connect with a provider in a 1:1 video call. The flow of the application should be as follows:
 - Provider starts a consultation and generates a shareable link
 - Patient opens the link to join a waiting room
 - Provider admits the patient to start the call (two-way audio and video + chat)
 - Patient/Provider should be able to reconnect if they lose connection
 - Session should end if the provider does not reconnect within 10 minutes
 - Provider ends the session, app leaves behind a record of the session (events)

Codebase design should focus on maintainability and future extensibility. It is important that each file/class sticks to a single responsibility which can be easily understood. Unit tests are mandatory

Out of scope:
 - Authentication/Authorisation
 - CI/CD
 - Group calls
 - Visual design
 - Mobile application
 - Scaling concerns (this should run as a simple, local application)
