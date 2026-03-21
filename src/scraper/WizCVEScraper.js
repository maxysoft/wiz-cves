const axios = require('axios');
const https = require('https');
const ProgressBar = require('progress');
const logger = require('../utils/logger');
const config = require('../config');
const { getRandomUserAgent } = require('../config');
const {
  sleep,
  saveCheckpoint,
  saveCVEsToDatabase,
  validateCVEData,
  cleanText
} = require('../utils/helpers');

class WizCVEScraper {
  constructor(options = {}) {
    this.cveData = [];
    this.processedCount = 0;
    this.startTime = null;
    this.options = {
      delayBetweenRequests: options.delayBetweenRequests || config.scraping.delayBetweenRequests,
      retryAttempts: options.retryAttempts || config.scraping.retryAttempts,
      resumeFromCheckpoint: options.resumeFromCheckpoint || false,
      maxCVEs: options.maxCVEs || config.scraping.maxCVEs,
      hitsPerPage: options.hitsPerPage || config.algolia.hitsPerPage,
      maxPages: options.maxPages || config.algolia.maxPages,
      useComprehensiveScraping: options.useComprehensiveScraping !== false,
      parallelRequests: options.parallelRequests || config.scraping.maxConcurrentRequests || 3,
      circuitBreakerThreshold: options.circuitBreakerThreshold || config.scraping.circuitBreakerThreshold || 5,
      circuitBreakerTimeout: options.circuitBreakerTimeout || config.scraping.circuitBreakerTimeout || 60000,
      ...options
    };
    
    // Circuit breaker state
    this.circuitBreaker = {
      failures: 0,
      lastFailureTime: null,
      state: 'CLOSED' // CLOSED, OPEN, HALF_OPEN
    };
    
    logger.info(`Scraper initialized with useComprehensiveScraping: ${this.options.useComprehensiveScraping}`);
    
    // Algolia API configuration
    this.algoliaConfig = {
      baseUrl: config.algolia.baseUrl,
      apiKey: config.algolia.apiKey,
      applicationId: config.algolia.applicationId,
      indexName: config.algolia.indexName,
      timeout: config.algolia.timeout
    };
    
    // Comprehensive technology filters for parallel scraping
    this.technologyFilters = [
      'https://assets.wiz.io/technology-icons/LinuxDebian-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Linux Debian',
      'https://assets.wiz.io/technology-icons/LinuxUbuntu-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Linux Ubuntu',
      'https://assets.wiz.io/technology-icons/LinuxRedHat-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Linux Red Hat',
      'https://assets.wiz.io/technology-icons/WordPress-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||WordPress',
      'https://assets.wiz.io/technology-icons/LinuxOpenSUSE-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Linux openSUSE',
      'https://assets.wiz.io/technology-icons/NixOS-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||NixOS',
      'https://assets.wiz.io/technology-icons/LinuxGentoo-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Linux Gentoo',
      'https://assets.wiz.io/technology-icons/LinuxOracle-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Linux Oracle',
      'https://assets.wiz.io/technology-icons/Homebrew-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Homebrew',
      'https://assets.wiz.io/technology-icons/AmazonLinux-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Amazon Linux',
      'https://assets.wiz.io/technology-icons/LinuxFedora-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Linux Fedora',
      'https://assets.wiz.io/technology-icons/LinuxKernel-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Linux Kernel',
      'https://assets.wiz.io/technology-icons/LinuxAlpine-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Linux Alpine',
      'https://assets.wiz.io/technology-icons/Java-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Java',
      'https://assets.wiz.io/technology-icons/LinuxPhoton-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Linux Photon',
      'https://assets.wiz.io/technology-icons/PHP-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||PHP',
      'https://assets.wiz.io/technology-icons/AlmaLinux-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Alma Linux',
      'https://assets.wiz.io/technology-icons/CBLMariner-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||CBL Mariner',
      'https://assets.wiz.io/technology-icons/AlibabaCloudLinux-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Alibaba Cloud Linux (Aliyun Linux)',
      'https://assets.wiz.io/technology-icons/JavaScript-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||JavaScript',
      'https://assets.wiz.io/technology-icons/LinuxCentOS-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Linux CentOS',
      'https://assets.wiz.io/technology-icons/Python-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Python',
      'https://assets.wiz.io/technology-icons/GoogleChrome-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Google Chrome',
      'https://assets.wiz.io/technology-icons/MozillaFirefox-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Mozilla Firefox',
      'https://assets.wiz.io/technology-icons/Chromium-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Chromium',
      'https://assets.wiz.io/technology-icons/Chainguard-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Chainguard',
      'https://assets.wiz.io/technology-icons/RockyLinux-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Rocky Linux',
      'https://assets.wiz.io/technology-icons/macOS-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||macOS',
      'https://assets.wiz.io/technology-icons/AdobeAcrobatReaderClassic-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Adobe Acrobat Reader Classic',
      'https://assets.wiz.io/technology-icons/AdobeAcrobatClassic-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Adobe Acrobat Classic',
      'https://assets.wiz.io/technology-icons/AdobeAcrobatReaderContinuous-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Adobe Acrobat Reader Continuous',
      'https://assets.wiz.io/technology-icons/AdobeAcrobatContinuous-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Adobe Acrobat Continuous',
      'https://assets.wiz.io/technology-icons/AdobeReaderDCContinuous-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Adobe Reader DC Continuous',
      'https://assets.wiz.io/technology-icons/Rust-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Rust',
      'https://assets.wiz.io/technology-icons/MozillaThunderbird-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Mozilla Thunderbird',
      'https://assets.wiz.io/technology-icons/MySQL-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||MySQL',
      'https://assets.wiz.io/technology-icons/AppleSafari-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Apple Safari',
      'https://assets.wiz.io/technology-icons/AdobeAcrobat-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Adobe Acrobat',
      'https://assets.wiz.io/technology-icons/AdobeReaderDCClassic-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Adobe Reader DC Classic',
      'https://assets.wiz.io/technology-icons/MozillaFirefoxESR-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Mozilla Firefox ESR',
      'https://assets.wiz.io/technology-icons/ContainerOptimizedOS-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Container-Optimized OS',
      'https://assets.wiz.io/technology-icons/Wolfi-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Wolfi',
      'https://assets.wiz.io/technology-icons/MySQLClientCAPI-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||MySQL Client C API',
      'https://assets.wiz.io/technology-icons/GitLab-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||GitLab',
      'https://assets.wiz.io/technology-icons/GitlabEnterprise-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Gitlab Enterprise',
      'https://assets.wiz.io/technology-icons/AdobeFlashPlayer-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Adobe Flash Player',
      'https://assets.wiz.io/technology-icons/ActiveXControl-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||ActiveX Control',
      'https://assets.wiz.io/technology-icons/OracleJRE-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Oracle JRE',
      'https://assets.wiz.io/technology-icons/OracleJDK-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Oracle JDK',
      'https://assets.wiz.io/technology-icons/JRE-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||JRE',
      'https://assets.wiz.io/technology-icons/Ruby-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Ruby',
      'https://assets.wiz.io/technology-icons/AdobeExperienceManager-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Adobe Experience Manager',
      'https://assets.wiz.io/technology-icons/FoxitPDFReader-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Foxit PDF Reader',
      'https://assets.wiz.io/technology-icons/AdobeReader-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Adobe Reader',
      'https://assets.wiz.io/technology-icons/PepperFlashforGoogleChrome-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Pepper Flash for Google Chrome',
      'https://assets.wiz.io/technology-icons/MozillaSeaMonkey-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Mozilla SeaMonkey',
      'https://assets.wiz.io/technology-icons/AppleiTunes-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Apple iTunes',
      'https://assets.wiz.io/technology-icons/JDK-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||JDK',
      'https://assets.wiz.io/technology-icons/AmazonCorrettoJDK-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Amazon Corretto JDK',
      'https://assets.wiz.io/technology-icons/FoxitPhantomPDF-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Foxit PhantomPDF',
      'https://assets.wiz.io/technology-icons/EclipseAdoptiumJDK-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Eclipse Adoptium JDK',
      'https://assets.wiz.io/technology-icons/OpenJDKJDK-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||OpenJDK JDK',
      'https://assets.wiz.io/technology-icons/ImageMagick-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||ImageMagick',
      'https://assets.wiz.io/technology-icons/Wireshark-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Wireshark',
      'https://assets.wiz.io/technology-icons/Jenkins-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Jenkins',
      'https://assets.wiz.io/technology-icons/F5BIGIPVirtualEdition-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||F5 BIG-IP Virtual Edition (tier - best)',
      'https://assets.wiz.io/technology-icons/OpenJDKJRE-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||OpenJDK JRE',
      'https://assets.wiz.io/technology-icons/CSharp-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||C#',
      'https://assets.wiz.io/technology-icons/AdobeAIR-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Adobe AIR',
      'https://assets.wiz.io/technology-icons/RedHatEnterpriseLinuxCoreOS-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Red Hat Enterprise Linux CoreOS (RHCOS)',
      'https://assets.wiz.io/technology-icons/F5BIGIPVirtualEdition-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||F5 BIG-IP Virtual Edition',
      'https://assets.wiz.io/technology-icons/OracleDatabaseServer-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Oracle Database Server',
      'https://assets.wiz.io/technology-icons/NodeJS-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Node.js',
      'https://assets.wiz.io/technology-icons/PerconaServerforMySQL-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Percona Server for MySQL',
      'https://assets.wiz.io/technology-icons/AdobeFlashPlayerESR-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Adobe Flash Player ESR',
      'https://assets.wiz.io/technology-icons/Ffmpeg-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Ffmpeg',
      'https://assets.wiz.io/technology-icons/F5BIGIPVirtualEdition-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||F5 BIG-IP Virtual Edition (tier - better)',
      'https://assets.wiz.io/technology-icons/F5BIGIPAdvancedFirewallManager-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||F5 BIG-IP Advanced Firewall Manager',
      'https://assets.wiz.io/technology-icons/TensorFlow-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||TensorFlow',
      'https://assets.wiz.io/technology-icons/Bottlerocket-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Bottlerocket',
      'https://assets.wiz.io/technology-icons/MariaDBServer-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||MariaDB Server',
      'https://assets.wiz.io/technology-icons/VirtualBox-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||VirtualBox',
      'https://assets.wiz.io/technology-icons/OpenShiftNode-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||OpenShift Node',
      'https://assets.wiz.io/technology-icons/IBMWebSphereApplicationServer-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||IBM WebSphere Application Server',
      'https://assets.wiz.io/technology-icons/IBMJDK-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||IBM JDK',
      'https://assets.wiz.io/technology-icons/QEMU-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||QEMU',
      'https://assets.wiz.io/technology-icons/cPanel-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||cPanel',
      'https://assets.wiz.io/technology-icons/IBMWebSphereAppServer-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||IBM WebSphere App Server',
      'https://assets.wiz.io/technology-icons/MicrosoftInternetExplorer9-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Microsoft Internet Explorer 9',
      'https://assets.wiz.io/technology-icons/AppleiCloud-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Apple iCloud',
      'https://assets.wiz.io/technology-icons/IBMDb2-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||IBM Db2',
      'https://assets.wiz.io/technology-icons/GraphicsMagick-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||GraphicsMagick',
      'https://assets.wiz.io/technology-icons/OraclePeoplesoftEnterprisePeopletools-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Oracle Peoplesoft Enterprise Peopletools',
      'https://assets.wiz.io/technology-icons/MicrosoftInternetExplorer8-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Microsoft Internet Explorer 8',
      'https://assets.wiz.io/technology-icons/OracleEBusinessSuite-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Oracle E-Business Suite',
      'https://assets.wiz.io/technology-icons/OracleCoherence-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Oracle Coherence',
      'https://assets.wiz.io/technology-icons/MicrosoftInternetExplorer10-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Microsoft Internet Explorer 10',
      'https://assets.wiz.io/technology-icons/OracleWebLogicServer-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Oracle WebLogic Server',
      'https://assets.wiz.io/technology-icons/ApacheHTTPServer-4f28eb64-41fe-4ec9-9d63-931187a2b105.svg||Apache HTTP Server'
    ];
  }

  /**
   * Initialize the scraper
   */
  async initialize() {
    try {
      logger.info('Initializing Algolia API scraper...');
      
      // Test API connectivity
      await this.testApiConnectivity();
      
      logger.info('Algolia API scraper initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize scraper:', error);
      throw error;
    }
  }

  /**
   * Test API connectivity
   */
  async testApiConnectivity() {
    try {
      logger.info('Testing Algolia API connectivity...');
      
      const response = await this.makeAlgoliaRequest(0, 1);
      
      if (response && response.results && response.results[0]) {
        const totalHits = response.results[0].nbHits || 0;
        logger.info(`API connectivity test successful. Total CVEs available: ${totalHits}`);
        return totalHits;
      }
      throw new Error('Invalid API response structure');
    } catch (error) {
      logger.error('API connectivity test failed:', error);
      throw error;
    }
  }

  /**
   * Make a request to Algolia API with retry logic and exponential backoff
   * @param {number} page - Page number
   * @param {number} hitsPerPage - Number of hits per page
   * @param {Array} technologyFilters - Technology filters to apply
   * @returns {Promise<Object>} API response
   */
  async makeAlgoliaRequest(page = 0, hitsPerPage = null, technologyFilters = []) {
    // Check circuit breaker state
    if (this.circuitBreaker.state === 'OPEN') {
      const timeSinceLastFailure = Date.now() - this.circuitBreaker.lastFailureTime;
      if (timeSinceLastFailure < this.options.circuitBreakerTimeout) {
        throw new Error(`Circuit breaker is OPEN. Failing fast. Time remaining: ${Math.round((this.options.circuitBreakerTimeout - timeSinceLastFailure) / 1000)}s`);
      } else {
        // Transition to HALF_OPEN
        this.circuitBreaker.state = 'HALF_OPEN';
        logger.info('Circuit breaker transitioning to HALF_OPEN state');
      }
    }

    const maxRetries = this.options.retryAttempts;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const requestPayload = {
          requests: [{
            indexName: this.algoliaConfig.indexName,
            facets: [
              'affectedTechnologies.filter',
              'exploitable',
              'hasCisaKevExploit',
              'hasFix',
              'isHighProfileThreat',
              'publishedAt',
              'severity',
              'sourceFeeds.filter'
            ],
            highlightPostTag: '__/ais-highlight__',
            highlightPreTag: '__ais-highlight__',
            hitsPerPage: hitsPerPage || this.options.hitsPerPage,
            maxValuesPerFacet: 200,
            page,
            query: '',
            facetFilters: technologyFilters.length > 0 ? [
              technologyFilters.map(filter => `affectedTechnologies.filter:${filter}`)
            ] : []
          }]
        };

        const headers = {
          'Content-Type': 'application/json',
          'User-Agent': getRandomUserAgent(),
          'x-algolia-agent': 'Algolia for JavaScript (5.25.0); Search (5.25.0); Browser; instantsearch.js (4.78.3); react (19.1.0); react-instantsearch (7.15.8); react-instantsearch-core (7.15.8); next.js (15.3.3); JS Helper (3.25.0)',
          'x-algolia-api-key': this.algoliaConfig.apiKey,
          'x-algolia-application-id': this.algoliaConfig.applicationId
        };

        // Configure axios with timeout and retry-friendly settings
        const axiosConfig = {
          headers,
          timeout: this.algoliaConfig.timeout,
          // Add connection timeout
          httpsAgent: new https.Agent({
            keepAlive: true,
            timeout: this.algoliaConfig.timeout,
            freeSocketTimeout: 30000
          }),
          // Retry on network errors
          validateStatus: (status) => status < 500
        };

        const response = await axios.post(this.algoliaConfig.baseUrl, requestPayload, axiosConfig);
        
        // Check for successful response
        if (response.status >= 200 && response.status < 300) {
          // Reset circuit breaker on success
          if (this.circuitBreaker.state === 'HALF_OPEN') {
            this.circuitBreaker.state = 'CLOSED';
            this.circuitBreaker.failures = 0;
            logger.info('Circuit breaker reset to CLOSED state after successful request');
          }
          
          if (attempt > 1) {
            logger.info(`Request succeeded on attempt ${attempt}`);
          }
          return response.data;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error) {
        lastError = error;
        const isRetryableError = this.isRetryableError(error);
        
        if (attempt === maxRetries || !isRetryableError) {
          // Update circuit breaker on final failure
          this.circuitBreaker.failures++;
          this.circuitBreaker.lastFailureTime = Date.now();
          
          if (this.circuitBreaker.failures >= this.options.circuitBreakerThreshold) {
            this.circuitBreaker.state = 'OPEN';
            logger.warn(`Circuit breaker opened after ${this.circuitBreaker.failures} failures`);
          }
          
          logger.error(`Algolia API request failed after ${attempt} attempts:`, {
            error: error.message,
            code: error.code,
            page,
            filters: technologyFilters.length,
            retryable: isRetryableError,
            circuitBreakerState: this.circuitBreaker.state,
            circuitBreakerFailures: this.circuitBreaker.failures
          });
          throw error;
        }

        // Calculate exponential backoff delay
        const baseDelay = 1000; // 1 second
        const backoffDelay = baseDelay * Math.pow(2, attempt - 1);
        const jitterDelay = Math.random() * 1000; // Add jitter to prevent thundering herd
        const totalDelay = Math.min(backoffDelay + jitterDelay, 30000); // Cap at 30 seconds

        logger.warn(`Request failed (attempt ${attempt}/${maxRetries}), retrying in ${Math.round(totalDelay)}ms:`, {
          error: error.message,
          code: error.code,
          page,
          filters: technologyFilters.length
        });

        await sleep(totalDelay);
      }
    }

    throw lastError;
  }

  /**
   * Determine if an error is retryable
   * @param {Error} error - The error to check
   * @returns {boolean} Whether the error is retryable
   */
  isRetryableError(error) {
    // Network timeout errors
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED') {
      return true;
    }
    
    // Axios timeout
    if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
      return true;
    }
    
    // HTTP 5xx server errors
    if (error.response && error.response.status >= 500) {
      return true;
    }
    
    // Rate limiting (429)
    if (error.response && error.response.status === 429) {
      return true;
    }
    
    // DNS resolution errors
    if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      return true;
    }
    
    return false;
  }

  /**
   * Load all CVEs using comprehensive scraping strategy
   */
  async loadAllCVEs() {
    try {
      if (this.options.useComprehensiveScraping) {
        logger.info('Using comprehensive scraping strategy with technology filters');
        return await this.loadCVEsComprehensive();
      }
      logger.info('Using standard scraping strategy');
      return await this.loadCVEsStandard();
    } catch (error) {
      logger.error('Error during CVE loading:', error);
      throw error;
    }
  }

  /**
   * Make a request to the Algolia Browse API (cursor-based, no 1000-result limit).
   * The Browse API returns ALL index records without the pagination restriction of the
   * standard Search API (which caps at paginationLimitedTo, typically 1 000 hits).
   *
   * @param {string|null} cursor - Cursor returned by a previous browse response, or null to start.
   * @param {number} hitsPerPage - Records to return per request (max 1000 for Browse).
   * @returns {Promise<Object>} Browse response containing `hits`, optional `cursor`, and `nbHits`.
   */
  async makeBrowseRequest(cursor = null, hitsPerPage = 1000) {
    const browseUrl = `${this.algoliaConfig.baseUrl.replace('/1/indexes/*/queries', '')}/1/indexes/${this.algoliaConfig.indexName}/browse`;

    const maxRetries = this.options.retryAttempts;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const body = cursor ? { cursor } : { query: '', hitsPerPage };

        const headers = {
          'Content-Type': 'application/json',
          'User-Agent': getRandomUserAgent(),
          'x-algolia-agent': 'Algolia for JavaScript (5.25.0); Search (5.25.0); Browser',
          'x-algolia-api-key': this.algoliaConfig.apiKey,
          'x-algolia-application-id': this.algoliaConfig.applicationId
        };

        const axiosConfig = {
          headers,
          timeout: this.algoliaConfig.timeout,
          httpsAgent: new https.Agent({
            keepAlive: true,
            timeout: this.algoliaConfig.timeout,
            freeSocketTimeout: 30000
          }),
          validateStatus: (status) => status < 500
        };

        logger.debug(`Browse request: cursor=${cursor ? 'present' : 'null'}, hitsPerPage=${hitsPerPage}, attempt=${attempt}`);

        const response = await axios.post(browseUrl, body, axiosConfig);

        if (response.status >= 200 && response.status < 300) {
          if (attempt > 1) {
            logger.info(`Browse request succeeded on attempt ${attempt}`);
          }
          return response.data;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error) {
        lastError = error;
        const isRetryable = this.isRetryableError(error);

        if (attempt === maxRetries || !isRetryable) {
          logger.error(`Browse API request failed after ${attempt} attempts: ${error.message}`);
          throw error;
        }

        const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 1000, 30000);
        logger.warn(`Browse request failed (attempt ${attempt}/${maxRetries}), retrying in ${Math.round(backoffDelay)}ms: ${error.message}`);
        await sleep(backoffDelay);
      }
    }

    throw lastError;
  }

  /**
   * Standard CVE loading using the Algolia Browse API with cursor-based pagination.
   *
   * The Browse API has no 1,000-hit pagination restriction and returns ALL index
   * records. Each response contains a `cursor` field that must be passed to the
   * next request; pagination ends when no cursor is returned.
   *
   * The Browse API supports up to 1,000 records per request; we use that maximum
   * to minimise the number of round-trips needed for large indices.
   */
  async loadCVEsStandard() {
    logger.info('Starting standard CVE loading via Algolia Browse API...');

    // Browse API maximum is 1,000 records per request — use that for efficiency.
    const hitsPerPage = Math.min(this.options.hitsPerPage || 1000, 1000);
    const maxCVEs = this.options.maxCVEs || null;

    logger.info(`Browse hitsPerPage: ${hitsPerPage}${maxCVEs ? `, maxCVEs cap: ${maxCVEs}` : ', no CVE cap (fetching all)'}`);

    // Track how many CVEs were saved last time to trigger periodic saves correctly.
    let lastSavedCount = 0;
    const checkpointInterval = config.output?.checkpointInterval || 100;
    let cursor = null;
    let pageNum = 1;
    let totalHits = null;

    // Create a progress bar (total becomes known after the first response)
    const progressBar = new ProgressBar('Loading CVEs [:bar] :current CVEs fetched', {
      complete: '█',
      incomplete: '░',
      width: 40,
      total: maxCVEs || 1000000 // use a large sentinel when cap is unknown
    });

    do {
      try {
        logger.debug(`Fetching browse page ${pageNum}, collected so far=${this.cveData.length}`);

        const response = await this.makeBrowseRequest(cursor, hitsPerPage);

        if (!response || !Array.isArray(response.hits)) {
          logger.warn('Unexpected Browse API response structure — stopping pagination');
          break;
        }

        if (pageNum === 1) {
          totalHits = response.nbHits || 0;
          logger.info(`Total CVEs available in index: ${totalHits}`);
          // Update progress bar total now that we know the real count
          progressBar.total = maxCVEs || totalHits || 1000000;
        }

        const hits = response.hits;
        logger.debug(`Browse page ${pageNum}: received ${hits.length} hits`);

        // Process each CVE from this page
        for (const hit of hits) {
          if (maxCVEs && this.cveData.length >= maxCVEs) {
            break;
          }

          const cveData = this.transformAlgoliaHitToCVE(hit);
          if (cveData && !validateCVEData(cveData).error) {
            this.cveData.push(cveData);
          }
        }

        progressBar.tick(hits.length);

        // Advance cursor for next request; absence of cursor signals last page
        cursor = response.cursor || null;
        pageNum++;

        // Periodically save accumulated CVEs to the database so data is available
        // even when a full scrape takes a long time (e.g. with gentle mode enabled).
        if (this.cveData.length - lastSavedCount >= checkpointInterval && this.cveData.length > 0) {
          try {
            saveCVEsToDatabase(this.cveData);
            lastSavedCount = this.cveData.length;
            logger.info(`Periodic save: ${this.cveData.length} CVEs stored (page ${pageNum - 1})`);
          } catch (saveError) {
            logger.warn('Periodic database save failed:', saveError.message);
          }
        }

        if (maxCVEs && this.cveData.length >= maxCVEs) {
          logger.info(`Reached maximum CVE limit: ${maxCVEs}`);
          break;
        }

        // Add delay between page requests to avoid rate limiting
        if (cursor) {
          await sleep(this.options.delayBetweenRequests);
        }

      } catch (error) {
        logger.error(`Failed to fetch browse page ${pageNum}:`, error.message);
        // Stop on unrecoverable error — partial results were already accumulated
        break;
      }
    } while (cursor !== null);

    logger.info(`Finished loading CVEs. Total collected: ${this.cveData.length}`);
  }

  /**
   * Comprehensive CVE loading with parallel technology-based filtering
   */
  async loadCVEsComprehensive() {
    logger.info('Starting comprehensive CVE loading with parallel technology filters...');
    
    const allCVEs = new Map(); // Use Map to automatically handle duplicates by CVE ID
    this.currentAllCVEs = allCVEs; // Store reference for graceful shutdown access
    const maxHitsToFetch = this.options.maxCVEs || 140558; // Use maxCVEs or fetch all available
    
    // Create progress bars
    const techProgressBar = new ProgressBar('Technology filters [:bar] :current/:total (:percent) ETA: :etas', {
      complete: '█',
      incomplete: '░',
      width: 40,
      total: this.technologyFilters.length
    });
    
    // Define a function to process each technology filter
    const processTechnologyFilter = async (filter) => {
      try {
        const techName = filter.split('||')[1];
        logger.info(`Fetching CVEs for technology: ${techName}`);
        
        await this.fetchCVEsWithFilters([filter], allCVEs, maxHitsToFetch);
        
        techProgressBar.tick();
        return { success: true, technology: techName };
      } catch (error) {
        logger.error(`Failed to fetch CVEs for filter ${filter}:`, error.message);
        techProgressBar.tick();
        return { success: false, technology: filter.split('||')[1], error: error.message };
      }
    };
    
    // Define function to fetch initial CVEs without filters
    const fetchInitialCVEs = async () => {
      try {
        logger.info(`Fetching up to ${maxHitsToFetch} CVEs without filters...`);
        await this.fetchCVEsWithFilters([], allCVEs, maxHitsToFetch);
        logger.info('Initial CVE fetch completed');
        return { success: true, type: 'initial' };
      } catch (error) {
        logger.error('Failed to fetch initial CVEs:', error.message);
        return { success: false, type: 'initial', error: error.message };
      }
    };
    
    // Process all technology filters in parallel with concurrency control
    const concurrencyLimit = this.options.parallelRequests || 5; // Default to 5 parallel requests
    logger.info(`Using concurrency limit of ${concurrencyLimit} for parallel processing`);
    
    // Split the filters into chunks to control concurrency
    const chunks = [];
    for (let i = 0; i < this.technologyFilters.length; i += concurrencyLimit) {
      chunks.push(this.technologyFilters.slice(i, i + concurrencyLimit));
    }
    
    // Create array of all parallel tasks
    const allTasks = [];
    
    // Add initial CVE fetch task
    allTasks.push(fetchInitialCVEs());
    
    // Add technology filter tasks in chunks
    for (const chunk of chunks) {
      const chunkPromises = chunk.map(filter => processTechnologyFilter(filter));
      allTasks.push(...chunkPromises);
      
      // Add a small delay between chunk creation to stagger requests
      if (this.options.delayBetweenRequests > 0 && chunks.indexOf(chunk) < chunks.length - 1) {
        await sleep(this.options.delayBetweenRequests / 2); // Half delay for staggering
      }
    }
    
    logger.info(`Starting ${allTasks.length} parallel tasks (1 initial + ${this.technologyFilters.length} technology filters)...`);
    
    // Execute all tasks in parallel with improved error handling
    const results = await Promise.allSettled(allTasks);
    
    // Process results with detailed logging
    const successfulResults = [];
    const failedResults = [];
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        successfulResults.push(result.value);
      } else {
        const taskType = index === 0 ? 'initial' : `filter-${this.technologyFilters[index - 1]}`;
        // result.reason is an Error object; result.value.error is already a string (from catch blocks)
        const errorMsg = result.status === 'rejected'
          ? result.reason.message
          : result.value.error;
        failedResults.push({ taskType, error: errorMsg });
        logger.warn(`Task failed: ${taskType} - ${errorMsg}`);
      }
    });
    
    logger.info(`Parallel execution completed: ${successfulResults.length} successful, ${failedResults.length} failed`);
    
    // Log failed tasks for debugging
    if (failedResults.length > 0) {
      logger.warn('Failed tasks summary:', failedResults.map(f => f.taskType));
    }
    
    // Combine all CVE data from successful tasks into the existing Map
    successfulResults.forEach(result => {
      if (result.data && Array.isArray(result.data)) {
        result.data.forEach(cve => {
          if (cve && cve.cveId) {
            allCVEs.set(cve.cveId, cve);
          }
        });
      }
    });
    
    // Check if we have any data at all
    if (allCVEs.size === 0) {
      logger.error('No CVE data collected from any source. All parallel tasks failed.');
      throw new Error('Complete failure: No CVE data could be retrieved from any source');
    }
    
    // Warn if too many tasks failed
    const failureRate = failedResults.length / allTasks.length;
    if (failureRate > 0.5) {
      logger.warn(`High failure rate detected: ${Math.round(failureRate * 100)}% of tasks failed`);
    }
    
    // Convert Map to array (duplicates already removed)
    this.cveData = Array.from(allCVEs.values());
    
    // Don't clear currentAllCVEs immediately - keep it for graceful shutdown
    // It will be cleared in cleanup() method
    // this.currentAllCVEs = null;
    
    logger.info(`Final result: ${this.cveData.length} unique CVEs collected`);
    logger.info('Parallel comprehensive CVE loading completed.');
  }

  /**
   * Fetch CVEs with specific filters (thread-safe for parallel processing)
   */
  async fetchCVEsWithFilters(filters, cveMap, maxHits = 1000) {
    try {
      // Get total count for this filter
      const initialResponse = await this.makeAlgoliaRequest(0, 1, filters);
      const totalHits = Math.min(initialResponse.results[0].nbHits || 0, maxHits);
      const totalPages = Math.ceil(totalHits / this.options.hitsPerPage);
      
      if (totalHits === 0) {
        return;
      }
      
      // Collect CVEs for this filter first, then add to shared map
      const localCVEs = new Map();
      
      // Fetch all pages for this filter
      for (let page = 0; page < totalPages; page++) {
        try {
          const response = await this.makeAlgoliaRequest(page, this.options.hitsPerPage, filters);
          const hits = response.results[0].hits || [];
          
          // Process each CVE from this page
          for (const hit of hits) {
            // Check both shared map and local collection limits
            if ((cveMap.size >= this.options.maxCVEs && this.options.maxCVEs > 0) ||
                (localCVEs.size >= maxHits)) {
              break;
            }

            const cveData = this.transformAlgoliaHitToCVE(hit);
            if (cveData && !validateCVEData(cveData).error) {
              // Store in local map first
              localCVEs.set(cveData.cveId, cveData);
            }
          }
          
          // Break out of page loop if we've reached limits
          if ((cveMap.size >= this.options.maxCVEs && this.options.maxCVEs > 0) || 
              (localCVEs.size >= maxHits)) {
            break;
          }
          
          // Add delay between page requests
          if (page < totalPages - 1) {
            await sleep(this.options.delayBetweenRequests);
          }
          
        } catch (error) {
          logger.error(`Failed to fetch page ${page} for filter:`, error.message);
        }
      }
      
      // Add all local CVEs to the shared map (thread-safe operation)
      for (const [cveId, cveData] of localCVEs) {
        if (cveMap.size >= this.options.maxCVEs && this.options.maxCVEs > 0) {
          break;
        }
        cveMap.set(cveId, cveData);
      }
      
    } catch (error) {
      logger.error('Error fetching CVEs with filters:', error);
    }
  }

  /**
   * Extract additional resources from Wiz.io CVE detail page
   */
  async extractAdditionalResources(cveId) {
    try {
      if (!cveId) {
        return [];
      }
      const detailUrl = `https://www.wiz.io/vulnerability-database/cve/${cveId.toLowerCase()}`;
      const response = await axios.get(detailUrl, {
        timeout: this.algoliaConfig.timeout,
        headers: {
          'User-Agent': getRandomUserAgent()
        }
      });
      
      const html = response.data;
      const additionalResources = [];
      
      // Extract links from the "Additional resources" section
      const resourcesMatch = html.match(/<h2[^>]*>Additional resources<\/h2>[\s\S]*?<div[^>]*class="[^"]*prose[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      
      if (resourcesMatch && resourcesMatch[1]) {
        const resourcesSection = resourcesMatch[1];
        
        // Extract all links with their text
        const linkRegex = /<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
        let linkMatch;
        
        while ((linkMatch = linkRegex.exec(resourcesSection)) !== null) {
          const url = linkMatch[1].trim();
          const title = linkMatch[2].trim();
          
          if (url && title && url.startsWith('http')) {
            additionalResources.push({
              title,
              url,
              type: this.categorizeResourceType(url, title)
            });
          }
        }
      }
      
      return additionalResources;
    } catch (error) {
      logger.warn(`Failed to extract additional resources for ${cveId}:`, error.message);
      return [];
    }
  }
  
  /**
   * Categorize resource type based on URL and title
   */
  categorizeResourceType(url, title) {
    let hostname;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch (_err) {
      hostname = '';
    }
    const lowerTitle = title.toLowerCase();

    if (hostname === 'nvd.nist.gov') { return 'NVD'; }
    if (hostname === 'github.com' || hostname.endsWith('.github.com')) { return 'GitHub'; }
    if (hostname === 'vuldb.com') { return 'VulDB'; }
    if (hostname === 'cve.mitre.org') { return 'MITRE'; }
    if (hostname === 'www.exploit-db.com' || hostname === 'exploit-db.com') { return 'Exploit-DB'; }
    if (hostname.startsWith('security.') || lowerTitle.includes('advisory')) { return 'Security Advisory'; }
    if (lowerTitle.includes('patch') || lowerTitle.includes('fix')) { return 'Patch/Fix'; }
    if (lowerTitle.includes('poc') || lowerTitle.includes('proof of concept')) { return 'Proof of Concept'; }

    return 'Other';
  }

  /**
   * Transform Algolia hit data to CVE format.
   * Maps all available fields from the Algolia API response.
   */
  transformAlgoliaHitToCVE(hit) {
    try {
      const cveId = hit.externalId || hit.name || hit.id;

      // Prefer baseScore, then cnaScore, then legacy fields, then null
      const score = hit.baseScore ?? hit.cnaScore ?? hit.cvssScore ?? hit.score ?? null;

      // Build the detail URL from the CVE ID
      const detailUrl = cveId ? `https://www.wiz.io/vulnerability-database/cve/${cveId.toLowerCase()}` : '';

      // Published date: API returns milliseconds-since-epoch or an ISO string
      let publishedDate = 'N/A';
      if (hit.publishedAt) {
        try {
          const ts = typeof hit.publishedAt === 'number'
            ? new Date(hit.publishedAt)
            : new Date(hit.publishedAt);
          publishedDate = ts.toISOString().split('T')[0];
        } catch (_e) {
          publishedDate = 'N/A';
        }
      }

      return {
        cveId,
        severity: hit.severity || 'N/A',
        score: typeof score === 'number' ? score : 'N/A',
        technologies: hit.affectedTechnologies ?
          hit.affectedTechnologies.map(tech => tech.name).join(', ') : 'N/A',
        component: hit.affectedSoftware ?
          hit.affectedSoftware.slice(0, 3).join(', ') +
          (hit.affectedSoftware.length > 3 ? '...' : '') : 'N/A',
        publishedDate,
        detailUrl,
        description: cleanText(hit.description || ''),
        sourceUrl: hit.sourceUrl || '',
        hasCisaKevExploit: hit.hasCisaKevExploit || false,
        hasFix: hit.hasFix || false,
        isHighProfileThreat: hit.isHighProfileThreat || false,
        exploitable: hit.exploitable || false,
        // EPSS threat-intelligence scores
        epssPercentile: hit.epssPercentile ?? null,
        epssProbability: hit.epssProbability ?? null,
        // CVSS vector details
        baseScore: hit.baseScore ?? null,
        cnaScore: hit.cnaScore ?? null,
        cvss2: hit.cvss2 || null,
        cvss3: hit.cvss3 || null,
        // Source feed / advisory details
        sourceFeeds: hit.sourceFeeds || [],
        // AI-generated summary sections
        aiDescription: hit.aiDescription || null,
        batchId: hit.batchId || null,
        additionalResources: {
          sourceUrl: hit.sourceUrl || '',
          affectedSoftware: hit.affectedSoftware || [],
          affectedTechnologies: hit.affectedTechnologies || [],
          externalLinks: []
        }
      };
    } catch (error) {
      logger.error('Error transforming Algolia hit:', error);
      return null;
    }
  }

  /**
   * Extract CVE list (now just returns the loaded data)
   */
  extractCVEList() {
    logger.info('CVE list already extracted via API calls');
    return this.cveData;
  }

  /**
   * Process CVE details (now simplified since data comes from API)
   */
  processCVEDetails(cve) {
    try {
      // CVE details are already included in the API response
      // Just validate the data
      const validation = validateCVEData(cve);
      if (validation.error) {
        logger.warn(`CVE validation failed for ${cve.cveId}:`, validation.error.message);
        // Use the original data even if validation fails
      }
      return cve;
    } catch (error) {
      logger.error(`Error processing CVE ${cve.cveId}:`, error);
      return cve;
    }
  }

  /**
   * Main scraping method
   */
  async scrapeAllCVEs() {
    try {
      this.startTime = Date.now();
      logger.scrapeStart('Wiz CVE Database via Algolia API');
      
      await this.initialize();
      await this.loadAllCVEs();
      
      const cveList = await this.extractCVEList();
      
      if (cveList.length === 0) {
        logger.warn('No CVEs found via API');
        return {
          scrapeDate: new Date().toISOString(),
          totalCVEs: 0,
          cveData: []
        };
      }
      
      logger.info(`Processing ${cveList.length} CVEs...`);
      
      // Process CVEs (minimal processing since data comes from API)
      const processedCVEs = [];
      for (const cve of cveList) {
        try {
          const processedCVE = await this.processCVEDetails(cve);
          processedCVEs.push(processedCVE);
          
          this.processedCount++;
          
          if (logger.cveProcessed) {
            logger.cveProcessed(cve.cveId, this.processedCount, cveList.length);
          }
          
          // Save checkpoint periodically
          if (this.processedCount % (config.output?.checkpointInterval || 100) === 0) {
            await saveCheckpoint(processedCVEs, this.processedCount);
          }
          
        } catch (error) {
          if (logger.cveError) {
            logger.cveError(cve.cveId, error);
          }
          // Return the original CVE data
          processedCVEs.push(cve);
        }
      }
      
      const duration = Date.now() - this.startTime;
      if (logger.scrapeComplete) {
        logger.scrapeComplete(processedCVEs.length, duration);
      }
      
      return {
        scrapeDate: new Date().toISOString(),
        totalCVEs: processedCVEs.length,
        cveData: processedCVEs.sort((a, b) => a.cveId.localeCompare(b.cveId))
      };
      
    } catch (error) {
      if (logger.scrapeError) {
        logger.scrapeError(error);
      }
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    try {
      // Clear intermediate data to prevent memory leaks
      this.currentAllCVEs = null;

      // No browser to clean up in API-based approach
      logger.info('Cleanup completed successfully');
    } catch (error) {
      logger.error('Error during cleanup:', error);
    }
  }

  /**
   * Get scraping statistics
   */
  getStats() {
    const duration = this.startTime ? Date.now() - this.startTime : 0;
    return {
      processedCount: this.processedCount,
      duration,
      averageTimePerCVE: this.processedCount > 0 ? duration / this.processedCount : 0
    };
  }

  /**
   * Get all collected CVEs (including intermediate data during processing)
   * This method allows graceful shutdown to access data before final processing
   */
  getAllCollectedCVEs() {
    // If final cveData is available, return it
    if (this.cveData && this.cveData.length > 0) {
      return this.cveData;
    }
    
    // If we're in the middle of comprehensive loading, try to access intermediate data
    // This is a fallback for graceful shutdown scenarios
    if (this.currentAllCVEs && this.currentAllCVEs.size > 0) {
      return Array.from(this.currentAllCVEs.values());
    }
    
    return [];
  }
}

module.exports = WizCVEScraper;