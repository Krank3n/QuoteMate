/**
 * Job Details Screen
 * First step: Select template and enter job parameters
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Surface,
  Title,
  Card,
  Chip,
  ActivityIndicator,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import { useStore } from '../../store/useStore';
import { JOB_TEMPLATES } from '../../data/jobTemplates';
import { createJobFromTemplate } from '../../utils/materialsEstimator';
import { colors } from '../../theme';
import { JobTemplate } from '../../types';
import { analyzeJobDescription, convertLLMMaterialsToMaterials } from '../../services/llmService';
import { generateId } from '../../utils/generateId';
import { bunningsApi } from '../../services/bunningsApi';

export function JobDetailsScreen() {
  const navigation = useNavigation<any>();
  const { currentQuote, updateQuote } = useStore();

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [jobAddress, setJobAddress] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<JobTemplate | null>(null);
  const [customParams, setCustomParams] = useState<Record<string, number>>({});
  const [jobName, setJobName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Check if editing an existing quote
  const isEditingExisting = currentQuote && currentQuote.materials.length > 0;

  useEffect(() => {
    if (currentQuote) {
      setCustomerName(currentQuote.customerName);
      setCustomerEmail(currentQuote.customerEmail || '');
      setCustomerPhone(currentQuote.customerPhone || '');
      setJobAddress(currentQuote.jobAddress || '');
      setJobName(currentQuote.job.name);
      setJobDescription(currentQuote.job.description || '');

      // Load template if exists
      const template = JOB_TEMPLATES.find((t) => t.id === currentQuote.job.template);
      if (template) {
        setSelectedTemplate(template);
        setCustomParams(currentQuote.job.customParams || {});
      }
    }
  }, [currentQuote]);

  const handleTemplateSelect = (template: JobTemplate) => {
    setSelectedTemplate(template);

    // Initialize default params
    const defaults: Record<string, number> = {};
    template.requiredParams.forEach((param) => {
      defaults[param.key] = param.defaultValue || 0;
    });
    setCustomParams(defaults);
  };

  const handleParamChange = (key: string, value: string) => {
    setCustomParams((prev) => ({
      ...prev,
      [key]: parseFloat(value) || 0,
    }));
  };

  const handleAnalyzeCustomJob = async () => {
    if (!jobDescription.trim()) {
      Alert.alert('Missing Information', 'Please enter a job description');
      return;
    }

    setIsAnalyzing(true);

    try {
      // Call LLM to analyze job description
      const analysis = await analyzeJobDescription(jobDescription);

      if (!currentQuote) return;

      // Convert LLM materials to app materials format
      const baseMaterials = convertLLMMaterialsToMaterials(analysis.materials);

      // Add IDs to materials
      const materials = baseMaterials.map((m) => ({
        ...m,
        id: generateId(),
        price: 0,
        totalPrice: 0,
        manualPriceOverride: false,
      }));

      // Create job object
      const job = {
        id: generateId(),
        name: jobName || analysis.jobSummary || 'Custom Job',
        description: jobDescription,
        template: 'custom' as const,
        estimatedHours: analysis.estimatedHours,
      };

      // Update quote with analyzed data
      const updatedQuote = {
        ...currentQuote,
        customerName,
        customerEmail,
        customerPhone,
        jobAddress,
        job,
        materials,
        laborHours: analysis.estimatedHours,
      };

      updateQuote(updatedQuote);

      // Navigate to materials screen where prices will be fetched
      navigation.navigate('MaterialsList');
    } catch (error: any) {
      Alert.alert(
        'Analysis Failed',
        error.message || 'Failed to analyze job description. Please try again or enter materials manually.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleNext = () => {
    if (!currentQuote) return;

    if (!customerName.trim()) {
      Alert.alert('Missing Information', 'Please enter customer name');
      return;
    }

    if (!selectedTemplate) {
      Alert.alert('Missing Information', 'Please select a job template');
      return;
    }

    // Handle custom job differently
    if (selectedTemplate.id === 'custom') {
      // If editing existing quote, just navigate without re-analyzing
      if (isEditingExisting) {
        const updatedQuote = {
          ...currentQuote,
          customerName,
          customerEmail,
          customerPhone,
          jobAddress,
        };
        updateQuote(updatedQuote);
        navigation.navigate('MaterialsList');
        return;
      }
      // Only analyze for new custom jobs
      handleAnalyzeCustomJob();
      return;
    }

    let materials = currentQuote.materials;
    let estimatedHours = currentQuote.laborHours;
    let job = currentQuote.job;

    // Only regenerate materials if this is a new quote without materials
    if (!isEditingExisting) {
      const templateData = createJobFromTemplate(
        selectedTemplate,
        customParams,
        jobName || selectedTemplate.name
      );
      materials = templateData.materials;
      estimatedHours = templateData.estimatedHours;
      job = templateData.job;
    } else {
      // Update job details but keep existing materials
      job = {
        ...currentQuote.job,
        name: jobName || currentQuote.job.name,
        customParams,
      };
    }

    // Update quote with customer details (preserve materials)
    const updatedQuote = {
      ...currentQuote,
      customerName,
      customerEmail,
      customerPhone,
      jobAddress,
      job,
      materials,
      laborHours: estimatedHours,
    };

    updateQuote(updatedQuote);
    navigation.navigate('MaterialsList');
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Title style={styles.sectionTitle}>Customer Details</Title>

        <TextInput
          label="Customer Name *"
          value={customerName}
          onChangeText={setCustomerName}
          mode="outlined"
          style={styles.input}
        />

        <TextInput
          label="Email"
          value={customerEmail}
          onChangeText={setCustomerEmail}
          mode="outlined"
          style={styles.input}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <TextInput
          label="Phone"
          value={customerPhone}
          onChangeText={setCustomerPhone}
          mode="outlined"
          style={styles.input}
          keyboardType="phone-pad"
        />

        <TextInput
          label="Job Address"
          value={jobAddress}
          onChangeText={setJobAddress}
          mode="outlined"
          style={styles.input}
          multiline
          numberOfLines={2}
        />
      </View>

      <View style={styles.section}>
        <Title style={styles.sectionTitle}>Select Job Template</Title>
        {isEditingExisting && (
          <Text style={styles.helperText}>
            Template is locked when editing an existing quote.
          </Text>
        )}

        <View style={styles.templatesGrid}>
          {JOB_TEMPLATES.map((template) => (
            <TouchableOpacity
              key={template.id}
              onPress={() => handleTemplateSelect(template)}
              style={styles.templateCardWrapper}
              disabled={isEditingExisting}
            >
              <Card
                style={[
                  styles.templateCard,
                  selectedTemplate?.id === template.id && styles.selectedCard,
                  isEditingExisting && styles.disabledCard,
                ]}
              >
                <Card.Content>
                  <MaterialCommunityIcons
                    name={getTemplateIcon(template.id)}
                    size={32}
                    color={
                      selectedTemplate?.id === template.id
                        ? colors.primary
                        : colors.onSurface
                    }
                  />
                  <Text style={styles.templateName}>{template.name}</Text>
                  <Text style={styles.templateDesc}>{template.description}</Text>
                </Card.Content>
              </Card>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Custom Job - AI Description */}
      {selectedTemplate && selectedTemplate.id === 'custom' && (
        <Surface style={styles.paramsSection}>
          <Title style={styles.sectionTitle}>Job Description</Title>
          {isEditingExisting ? (
            <Text style={styles.helperText}>
              Job description is locked when editing. To change it, create a new quote.
            </Text>
          ) : (
            <Text style={styles.helperText}>
              Describe the job in detail. AI will analyze it and suggest materials.
            </Text>
          )}

          <TextInput
            label="Job Name (Optional)"
            value={jobName}
            onChangeText={setJobName}
            mode="outlined"
            style={styles.input}
            placeholder="e.g., Backyard Deck Renovation"
            multiline
            numberOfLines={3}
          />

          <TextInput
            label="Job Description *"
            value={jobDescription}
            onChangeText={setJobDescription}
            mode="outlined"
            style={styles.input}
            multiline
            numberOfLines={6}
            placeholder="e.g., Build a 5x4 meter outdoor deck with 10 steps leading down to the garden. Need to replace old timber and add handrails."
            disabled={isEditingExisting}
          />

          {isAnalyzing && (
            <View style={styles.analyzingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.analyzingText}>Analyzing job with AI...</Text>
            </View>
          )}
        </Surface>
      )}

      {/* Standard Template Parameters */}
      {selectedTemplate && selectedTemplate.id !== 'custom' && selectedTemplate.requiredParams.length > 0 && (
        <Surface style={styles.paramsSection}>
          <Title style={styles.sectionTitle}>Job Parameters</Title>
          {isEditingExisting && (
            <Text style={styles.helperText}>
              Parameters are locked when editing. To change them, create a new quote.
            </Text>
          )}

          <TextInput
            label="Job Name (Optional)"
            value={jobName}
            onChangeText={setJobName}
            mode="outlined"
            style={styles.input}
            placeholder={selectedTemplate.name}
            multiline
            numberOfLines={2}
          />

          {selectedTemplate.requiredParams.map((param) => (
            <TextInput
              key={param.key}
              label={`${param.label} ${param.unit ? `(${param.unit})` : ''}`}
              value={customParams[param.key]?.toString() || ''}
              onChangeText={(value) => handleParamChange(param.key, value)}
              mode="outlined"
              style={styles.input}
              keyboardType="decimal-pad"
              disabled={isEditingExisting}
            />
          ))}
        </Surface>
      )}

      <Button
        mode="contained"
        onPress={handleNext}
        style={styles.nextButton}
        disabled={
          !selectedTemplate ||
          !customerName.trim() ||
          isAnalyzing ||
          (selectedTemplate?.id === 'custom' && !jobDescription.trim() && !isEditingExisting)
        }
        loading={isAnalyzing}
      >
        {isAnalyzing ? 'Analyzing...' : (selectedTemplate?.id === 'custom' && !isEditingExisting ? 'Analyze & Continue' : 'Next: Materials')}
      </Button>

      {/* Debug info - remove after testing */}
      {__DEV__ && selectedTemplate?.id === 'custom' && (
        <View style={styles.debugInfo}>
          <Text style={{ fontSize: 10, color: '#666' }}>
            Debug: Customer={customerName ? '✓' : '✗'} |
            Template={selectedTemplate ? '✓' : '✗'} |
            Description={jobDescription.trim() ? '✓' : '✗'}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function getTemplateIcon(templateId: string): keyof typeof MaterialCommunityIcons.glyphMap {
  switch (templateId) {
    case 'outdoor-stairs':
      return 'stairs';
    case 'timber-deck':
      return 'home-floor-2';
    case 'timber-fence':
      return 'fence';
    case 'pergola':
      return 'home-roof';
    default:
      return 'hammer-wrench';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  section: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  input: {
    marginBottom: 12,
  },
  templatesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
  },
  templateCardWrapper: {
    width: '50%',
    padding: 6,
  },
  templateCard: {
    minHeight: 140,
  },
  selectedCard: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  disabledCard: {
    opacity: 0.5,
  },
  templateName: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  templateDesc: {
    fontSize: 11,
    color: colors.onSurface,
  },
  paramsSection: {
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 16,
    borderRadius: 8,
    elevation: 2,
  },
  nextButton: {
    marginHorizontal: 20,
    marginBottom: 40,
    paddingVertical: 8,
  },
  helperText: {
    fontSize: 13,
    color: colors.onSurface,
    marginBottom: 12,
  },
  analyzingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    padding: 12,
    backgroundColor: colors.surface,
    borderRadius: 8,
  },
  analyzingText: {
    marginLeft: 12,
    fontSize: 14,
    color: colors.primary,
  },
  debugInfo: {
    padding: 10,
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: '#f0f0f0',
  },
});
