import { ArrowLeft, Shield, FileText, Database, Share2, Lock, UserCheck, Bell, Mail } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

export default function LegalPrivacy() {
  const effectiveDate = "January 24, 2026";
  const lastUpdated = "January 24, 2026";
  
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-14 items-center px-4">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2" data-testid="link-back-home">
              <ArrowLeft className="h-4 w-4" />
              Back to App
            </Button>
          </Link>
          <div className="flex-1" />
          <div className="flex items-center gap-2" data-testid="text-legal-header">
            <Shield className="h-5 w-5" />
            <span className="font-semibold">Legal Documents</span>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-4xl px-4 py-8" data-testid="section-privacy-main">
        <div className="space-y-6">
          <div className="text-center space-y-2" data-testid="section-privacy-header">
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-privacy-title">Privacy Policy</h1>
            <p className="text-muted-foreground" data-testid="text-effective-date">
              Effective Date: {effectiveDate} | Last Updated: {lastUpdated}
            </p>
            <div className="flex justify-center gap-2 pt-2" data-testid="badges-compliance">
              <Badge variant="outline" data-testid="badge-ucpa">UCPA Compliant</Badge>
              <Badge variant="outline" data-testid="badge-arizona">Arizona Law Compliant</Badge>
            </div>
          </div>

          <Card data-testid="card-privacy-introduction">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                1. Introduction
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                <strong>Sticker Burr</strong> ("Company," "we," "us," or "our"), a company operating from Arizona with business operations in Hildale, Utah, is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our Manufacturing Inventory Management System software and related services (the "Software").
              </p>
              <p>
                This policy complies with the <strong>Utah Consumer Privacy Act (UCPA)</strong>, effective December 31, 2023, Arizona data protection laws, and other applicable federal and state regulations.
              </p>
              <p>
                By using the Software, you consent to the data practices described in this Privacy Policy. If you do not agree with our policies and practices, do not use the Software.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-privacy-collection">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                2. Information We Collect
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <h4>2.1 Information You Provide Directly</h4>
              <ul>
                <li><strong>Account Information:</strong> Name, email address, password, and business information when you create an account</li>
                <li><strong>Business Data:</strong> Product information, inventory levels, supplier details, customer orders, pricing, and SKU data</li>
                <li><strong>Financial Data:</strong> Purchase orders, sales orders, invoices, and payment information synchronized from QuickBooks</li>
                <li><strong>Communication Data:</strong> Emails, support requests, and feedback you send to us</li>
              </ul>

              <h4>2.2 Information Collected Automatically</h4>
              <ul>
                <li><strong>Usage Data:</strong> Features used, actions taken, timestamps, and session information</li>
                <li><strong>Device Information:</strong> IP address, browser type, operating system, and device identifiers</li>
                <li><strong>Log Data:</strong> Server logs, error reports, and performance data</li>
                <li><strong>Cookies:</strong> Session cookies for authentication and preferences (see Section 8)</li>
              </ul>

              <h4>2.3 Information from Third-Party Services</h4>
              <p>When you connect third-party integrations, we receive data from:</p>
              <ul>
                <li><strong>QuickBooks:</strong> Financial data, invoices, vendors, customers, and sales history</li>
                <li><strong>Shopify:</strong> Orders, products, inventory levels, and customer information</li>
                <li><strong>Amazon:</strong> Marketplace orders, product listings, and fulfillment data</li>
                <li><strong>GoHighLevel:</strong> CRM contacts, opportunities, and customer interactions</li>
                <li><strong>Extensiv:</strong> Warehouse inventory, shipments, and 3PL data</li>
              </ul>
            </CardContent>
          </Card>

          <Card data-testid="card-privacy-usage">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Share2 className="h-5 w-5" />
                3. How We Use Your Information
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>We use your information for the following purposes:</p>
              <ul>
                <li><strong>Service Delivery:</strong> To provide, maintain, and improve the Software's functionality</li>
                <li><strong>Inventory Management:</strong> To track products, manage stock levels, and process orders</li>
                <li><strong>AI-Powered Features:</strong> To generate demand forecasts, reorder recommendations, and business insights using machine learning</li>
                <li><strong>Synchronization:</strong> To sync data between connected third-party platforms</li>
                <li><strong>Communications:</strong> To send order notifications, system alerts, and important updates</li>
                <li><strong>Support:</strong> To respond to your requests and provide customer service</li>
                <li><strong>Security:</strong> To detect fraud, prevent unauthorized access, and protect user data</li>
                <li><strong>Legal Compliance:</strong> To comply with applicable laws and regulations</li>
                <li><strong>Business Operations:</strong> To analyze usage patterns and improve our services</li>
              </ul>
              <p>
                <strong>AI Processing:</strong> We use OpenAI services to provide AI-powered analytics and recommendations. Your business data may be processed by AI systems to generate insights. This data is processed in accordance with OpenAI's enterprise data protection policies and is not used to train AI models.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-privacy-sharing">
            <CardHeader>
              <CardTitle>4. Information Sharing and Disclosure</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>We do not sell your personal information. We may share your information in the following circumstances:</p>
              
              <h4>4.1 Third-Party Service Providers</h4>
              <p>We share data with service providers who assist in operating the Software:</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Provider</th>
                    <th className="text-left py-2">Purpose</th>
                    <th className="text-left py-2">Data Shared</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="py-2">Intuit (QuickBooks)</td>
                    <td className="py-2">Accounting sync</td>
                    <td className="py-2">Financial data, vendors</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2">Shopify</td>
                    <td className="py-2">E-commerce sync</td>
                    <td className="py-2">Orders, inventory, products</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2">Amazon</td>
                    <td className="py-2">Marketplace sync</td>
                    <td className="py-2">Orders, listings</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2">GoHighLevel</td>
                    <td className="py-2">CRM integration</td>
                    <td className="py-2">Customer data, opportunities</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2">OpenAI</td>
                    <td className="py-2">AI analytics</td>
                    <td className="py-2">Business data for analysis</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2">SendGrid</td>
                    <td className="py-2">Email delivery</td>
                    <td className="py-2">Email addresses, content</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2">Shippo</td>
                    <td className="py-2">Shipping labels</td>
                    <td className="py-2">Shipping addresses</td>
                  </tr>
                  <tr>
                    <td className="py-2">Neon (PostgreSQL)</td>
                    <td className="py-2">Database hosting</td>
                    <td className="py-2">All application data</td>
                  </tr>
                </tbody>
              </table>

              <h4>4.2 Legal Requirements</h4>
              <p>We may disclose information if required to:</p>
              <ul>
                <li>Comply with a subpoena, court order, or legal process</li>
                <li>Enforce our Terms of Service or other agreements</li>
                <li>Protect the rights, property, or safety of the Company, users, or others</li>
                <li>Investigate potential violations of law</li>
              </ul>

              <h4>4.3 Business Transfers</h4>
              <p>
                If we are involved in a merger, acquisition, or sale of assets, your information may be transferred as part of that transaction. We will notify you of any such change.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-privacy-security">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5" />
                5. Data Security
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>We implement appropriate technical and organizational security measures to protect your information:</p>
              <ul>
                <li><strong>Encryption:</strong> Data is encrypted in transit using TLS/SSL and at rest using industry-standard encryption</li>
                <li><strong>Access Controls:</strong> Role-based access controls limit data access to authorized personnel</li>
                <li><strong>Authentication:</strong> Secure session-based authentication with password hashing</li>
                <li><strong>API Security:</strong> OAuth 2.0 for third-party integrations with secure token management</li>
                <li><strong>Monitoring:</strong> Continuous security monitoring and logging</li>
                <li><strong>Backups:</strong> Regular automated backups with secure storage</li>
              </ul>
              <p>
                While we strive to protect your information, no method of transmission over the Internet or electronic storage is 100% secure. We cannot guarantee absolute security.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-privacy-rights">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCheck className="h-5 w-5" />
                6. Your Privacy Rights (UCPA Compliance)
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                Under the <strong>Utah Consumer Privacy Act (UCPA)</strong> and applicable Arizona laws, you have the following rights:
              </p>
              
              <h4>6.1 Right to Know</h4>
              <p>You have the right to confirm whether we are processing your personal data and to access that data.</p>

              <h4>6.2 Right to Delete</h4>
              <p>You may request deletion of personal data you have provided to us, subject to certain exceptions (e.g., legal obligations, ongoing transactions).</p>

              <h4>6.3 Right to Data Portability</h4>
              <p>You may request a copy of your personal data in a portable, readily usable format.</p>

              <h4>6.4 Right to Opt-Out</h4>
              <p>You have the right to opt out of:</p>
              <ul>
                <li>Sale of personal data (we do not sell personal data)</li>
                <li>Targeted advertising (we do not engage in targeted advertising)</li>
                <li>Profiling in furtherance of decisions that produce legal or similarly significant effects</li>
              </ul>

              <h4>6.5 Right to Non-Discrimination</h4>
              <p>We will not discriminate against you for exercising your privacy rights.</p>

              <h4>6.6 How to Exercise Your Rights</h4>
              <p>
                To exercise any of these rights, contact us at <strong>privacy@stickerburr.com</strong>. We will respond to verified requests within 45 days. If we need additional time, we will notify you of the extension and the reason.
              </p>

              <h4>6.7 Authorized Agents</h4>
              <p>
                You may designate an authorized agent to make requests on your behalf. We will require written authorization and verification of your identity.
              </p>

              <h4>6.8 Appeals Process</h4>
              <p>
                If we deny your privacy request, you have the right to appeal our decision. To appeal:
              </p>
              <ul>
                <li>Submit your appeal to <strong>privacy@stickerburr.com</strong> within 30 days of receiving our response</li>
                <li>Include "Privacy Request Appeal" in the subject line</li>
                <li>Provide the original request details and reason for appeal</li>
                <li>We will respond to appeals within 60 days</li>
              </ul>
              <p>
                If you are a Utah resident and are not satisfied with the outcome of your appeal, you may file a complaint with the Utah Attorney General's Office at <strong>https://attorneygeneral.utah.gov</strong>. Arizona residents may contact the Arizona Attorney General's Office at <strong>https://www.azag.gov</strong>.
              </p>

              <h4>6.9 Opt-Out Mechanism</h4>
              <p>
                While we currently do not sell personal data or engage in targeted advertising, should our practices change in the future, we will:
              </p>
              <ul>
                <li>Update this Privacy Policy with at least 30 days notice</li>
                <li>Provide a clear opt-out mechanism accessible from your account settings</li>
                <li>Honor all opt-out requests promptly</li>
              </ul>
              <p>
                To submit any opt-out request or privacy concern, email <strong>privacy@stickerburr.com</strong>.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-privacy-retention">
            <CardHeader>
              <CardTitle>7. Data Retention</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>We retain your information for as long as necessary to:</p>
              <ul>
                <li>Provide the Software services</li>
                <li>Comply with legal obligations (e.g., tax records for 7 years)</li>
                <li>Resolve disputes and enforce agreements</li>
                <li>Maintain business records as required by law</li>
              </ul>
              <p>
                When you terminate your account, we will delete or anonymize your personal data within 90 days, unless retention is required for legal or business purposes.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-privacy-cookies">
            <CardHeader>
              <CardTitle>8. Cookies and Tracking Technologies</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>We use the following cookies and similar technologies:</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Type</th>
                    <th className="text-left py-2">Purpose</th>
                    <th className="text-left py-2">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="py-2">Session Cookie</td>
                    <td className="py-2">Authentication and security</td>
                    <td className="py-2">Session</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2">Preference Cookie</td>
                    <td className="py-2">Theme and display settings</td>
                    <td className="py-2">1 year</td>
                  </tr>
                  <tr>
                    <td className="py-2">Local Storage</td>
                    <td className="py-2">Application state</td>
                    <td className="py-2">Persistent</td>
                  </tr>
                </tbody>
              </table>
              <p>
                We do not use tracking cookies for advertising purposes. You can manage cookies through your browser settings.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-privacy-children">
            <CardHeader>
              <CardTitle>9. Children's Privacy</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                The Software is intended for business use and is not directed to individuals under 18 years of age. We do not knowingly collect personal information from children. If you believe we have collected information from a child, please contact us immediately.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-privacy-transfers">
            <CardHeader>
              <CardTitle>10. International Data Transfers</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                Your information may be transferred to and processed in the United States and other countries where our service providers operate. By using the Software, you consent to the transfer of your information to countries that may have different data protection laws than your jurisdiction.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-privacy-changes">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                11. Changes to This Privacy Policy
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                We may update this Privacy Policy from time to time. We will notify you of material changes by:
              </p>
              <ul>
                <li>Posting the updated policy with a new effective date</li>
                <li>Sending an email notification for significant changes</li>
                <li>Displaying a notice within the Software</li>
              </ul>
              <p>
                Your continued use of the Software after changes are posted constitutes acceptance of the updated policy.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-privacy-contact">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                12. Contact Us
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                If you have questions about this Privacy Policy or wish to exercise your privacy rights, contact us at:
              </p>
              <div className="bg-muted p-4 rounded-lg">
                <p className="mb-1"><strong>Sticker Burr</strong></p>
                <p className="mb-1">Hildale, Utah</p>
                <p className="mb-1">Privacy Inquiries: privacy@stickerburr.com</p>
                <p className="mb-1">General Inquiries: legal@stickerburr.com</p>
              </div>
              <p>
                For Utah residents: If you are not satisfied with our response to your privacy request, you may file a complaint with the Utah Attorney General's Office.
              </p>
            </CardContent>
          </Card>

          <Separator />

          <div className="text-center text-sm text-muted-foreground space-y-2" data-testid="section-privacy-footer">
            <p className="flex items-center justify-center gap-2" data-testid="text-compliance-notice">
              <Shield className="h-4 w-4 text-green-600 dark:text-green-400" />
              UCPA and Arizona Law Compliant
            </p>
            <p data-testid="text-copyright">
              © {new Date().getFullYear()} Sticker Burr. All rights reserved.
            </p>
            <div className="flex justify-center gap-4 pt-2" data-testid="nav-legal-links">
              <Link href="/legal/eula">
                <Button variant="ghost" size="sm" data-testid="link-eula">
                  End User License Agreement
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
