# SRMSS-ASE-Project
# Smart Route Management & Scheduling System (SRMSS)

## Overview

The Smart Route Management & Scheduling System (SRMSS) is a web-based transport management solution developed for the ASE Coursework Project. The system is designed to improve the management of routes, vehicles, schedules, depots, fuel usage, maintenance activities, conflicts, analytics and operational reporting within a public transportation environment.

The project was developed using a modern frontend architecture integrated with Firebase services for authentication, data storage and hosting.

---

## Project Objectives

The primary objectives of the system are:

* Manage transport depots and operational resources
* Maintain vehicle and driver records
* Manage routes and schedule assignments
* Monitor fuel consumption and maintenance activities
* Detect operational conflicts automatically
* Generate analytics and management reports
* Enforce secure role-based access control (RBAC)
* Support multi-depot operations

---

## Technologies Used

### Frontend

* HTML5
* CSS3
* JavaScript (ES6)
* Bootstrap
* Chart.js

### Backend & Cloud Services

* Firebase Authentication
* Cloud Firestore
* Firebase Hosting

### Development Tools

* Git
* GitHub
* Trello
* Figma
* Visual Studio Code

---

## System Features

### Authentication & Security

* Secure login system
* Password reset functionality
* Session management
* Route protection
* Role-Based Access Control (RBAC)

### User Management

* Create users
* Update users
* Role assignment
* Depot assignment
* Status management

### Depot Management

* Create and manage depots
* Assign administrators to depots
* Capacity monitoring

### Vehicle Management

* Vehicle registration
* Vehicle status tracking
* Depot-aware vehicle allocation

### Driver Management

* Driver profile management
* Route assignments
* Schedule integration

### Route Management

* Route creation and updates
* Route-to-depot assignment
* Depot-aware route filtering

### Schedule Management

* Route scheduling
* Vehicle allocation
* Driver allocation
* Depot-aware scheduling

### Fuel Management

* Fuel log recording
* Vehicle-based fuel tracking
* Depot-aware fuel monitoring

### Maintenance Management

* Maintenance scheduling
* Service tracking
* Vehicle maintenance history

### Conflict Detection

The system automatically identifies:

* Vehicles assigned during maintenance
* Inactive vehicles assigned to schedules
* Scheduling conflicts
* Resource allocation conflicts

### Analytics Dashboard

Provides visual insights into:

* Vehicle distribution
* Route allocation
* Depot performance
* Operational statistics

### Reports Module

Generates management reports for:

* Users
* Vehicles
* Routes
* Schedules
* Fuel Logs
* Maintenance Records
* Conflict Records

---

## Multi-Depot Architecture

A major enhancement introduced during development was support for multi-depot operations.

The system enforces depot-aware access throughout major modules:

* Users
* Vehicles
* Routes
* Schedules
* Fuel Logs
* Maintenance Records
* Conflict Detection
* Analytics
* Reports

### Access Model

| Role        | Access Level        |
| ----------- | ------------------- |
| Super Admin | All depots          |
| Admin       | Assigned depot only |
| Supervisor  | Assigned depot only |
| Staff       | Assigned depot only |
| Driver      | Assigned depot only |

---

## Project Structure

```text
frontend/
│
├── css/
├── firebase/
├── js/
├── pages/
├── components/
│
├── index.html
└── 404.html
```

---

## Installation

### Clone Repository

```bash
git clone https://github.com/Dhammika-Zent/SRMSS-ASE-Project.git
```

### Navigate to Project

```bash
cd SRMSS-ASE-Project
```

### Run Application

Open the project using:

* Visual Studio Code
* Live Server Extension

or deploy using Firebase Hosting.

---

## Firebase Configuration

The project uses:

* Firebase Authentication
* Cloud Firestore
* Firebase Hosting

A valid Firebase configuration must be added to:

```javascript
frontend/firebase/firebase-config.js
```

before running the application.

---

## Development Methodology

The project followed an Agile development approach.

Development was performed iteratively, allowing requirements to evolve throughout implementation. Feedback received during development led to the introduction of a multi-depot architecture, requiring significant refactoring across multiple modules while maintaining system stability and security.

---

## Future Enhancements

Potential future improvements include:

* Advanced report exporting (PDF/Excel)
* Email and SMS notifications
* Real-time GPS integration
* Predictive maintenance analytics
* Enhanced dashboard visualisations
* Automated testing pipelines
* Production-grade Firestore security rules
* Advanced audit logging

---

## Contributors

### Overall Development & System Integration

* Dhammika Senarathna

### Documentation, Testing, User Manual, Development of Driver & Vehicle Modules 

* K.Thushithan

### Diagrams, Wireframes, Development of Fuel & Maintanance Modules 

* Kayal

---

## Academic Project Notice

This project was developed as part of the ASE Software Engineering coursework and is intended for educational purposes.
